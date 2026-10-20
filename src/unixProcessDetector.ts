/**
 * Unix-based (macOS/Linux) process detection implementation.
 * Uses ps and lsof/ss/netstat commands.
 */

declare const process: any;
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { IPlatformStrategy } from './platformDetector';
import { LocalizationService } from './i18n/localizationService';
import { logger } from './logger';

const execAsync = promisify(exec);

import * as path from 'path';

export class UnixProcessDetector implements IPlatformStrategy {
    private platform: NodeJS.Platform;
    /** Available port detection command: 'lsof', 'ss', or 'netstat' */
    private availablePortCommand: 'lsof' | 'ss' | 'netstat' | null = null;

    constructor(platform: NodeJS.Platform) {
        this.platform = platform;
    }

    /**
     * Check if a command exists on the system using 'which'.
     */
    private async commandExists(command: string): Promise<boolean> {
        try {
            await execAsync(`which ${command}`, { timeout: 3000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Ensure at least one port detection command is available.
     * Checks lsof, ss, netstat in order of preference.
     * @throws Error if no command is available
     */
    async ensurePortCommandAvailable(): Promise<void> {
        // Already checked
        if (this.availablePortCommand) {
            return;
        }

        const commands = ['lsof', 'ss', 'netstat'] as const;
        const available: string[] = [];

        for (const cmd of commands) {
            if (await this.commandExists(cmd)) {
                available.push(cmd);
                if (!this.availablePortCommand) {
                    this.availablePortCommand = cmd;
                }
            }
        }

        logger.info('UnixDetector', `Port command check: available=[${available.join(', ') || 'none'}], using=${this.availablePortCommand || 'none'}`);

        if (!this.availablePortCommand) {
            const localizationService = LocalizationService.getInstance();
            const message = this.platform === 'darwin'
                ? localizationService.t('notify.portCommandRequiredDarwin')
                : localizationService.t('notify.portCommandRequired');

            vscode.window.showErrorMessage(message, { modal: false });
            throw new Error('No port detection command available (lsof/ss/netstat)');
        }
    }

    /**
     * 判断命令行是否属于 Antigravity 进程
     * 通过 --app_data_dir 参数或路径中包含 antigravity 来识别（兼容 1.x 与 2.x "Antigravity IDE"）
     */
    private isAntigravityProcess(commandLine: string): boolean {
        const lowerCmd = commandLine.toLowerCase();
        // 检查 --app_data_dir 参数 (兼容 antigravity, antigravity-ide)
        if (/--app_data_dir\s+["']?antigravity(-ide)?\b["']?/i.test(commandLine)) {
            return true;
        }
        // 检查路径中是否包含 antigravity (兼容 antigravity, Antigravity IDE, antigravity-ide 等)
        if (lowerCmd.includes('antigravity')) {
            return true;
        }
        return false;
    }

    /**
     * Get command to list Unix processes using ps and grep.
     */
    getProcessListCommand(processName: string): string {
        // Use ps -ww -eo pid,ppid,args to get PID, PPID and full command line
        // -ww: unlimited width (avoid truncation)
        // -e: select all processes
        // -o: user-defined format
        // grep -v graftcp: exclude graftcp wrapper processes (users may use graftcp to proxy language_server)
        return `ps -ww -eo pid,ppid,args | grep "${processName}" | grep -v grep | grep -v graftcp`;
    }

    parseProcessInfo(stdout: string): {
        pid: number;
        extensionPort: number;
        csrfToken: string;
    } | null {
        if (!stdout || stdout.trim().length === 0) {
            return null;
        }

        const lines = stdout.trim().split('\n');
        const currentPid = process.pid;
        const candidates: Array<{ pid: number; ppid: number; extensionPort: number; csrfToken: string; cmd: string }> = [];

        for (const line of lines) {
            // Format: PID PPID COMMAND...
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) {
                continue;
            }

            const pid = parseInt(parts[0], 10);
            const ppid = parseInt(parts[1], 10);

            // Reconstruct command line (it might contain spaces)
            const cmd = parts.slice(2).join(' ');

            if (isNaN(pid) || isNaN(ppid)) {
                continue;
            }

            // 防御性检查：跳过 graftcp 包装进程
            // graftcp 是用于代理 language_server 的工具，它本身不监听端口
            // 命令行格式如：/opt/graftcp/graftcp /path/to/language_server_linux_x64.bak ...
            const executable = parts[2]; // 命令行第一部分（可执行文件）
            if (executable.includes('graftcp')) {
                continue;
            }

            const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

            // 必须同时满足：有 csrf_token 且是 Antigravity 进程
            if (tokenMatch && tokenMatch[1] && this.isAntigravityProcess(cmd)) {
                const extensionPort = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 0;
                const csrfToken = tokenMatch[1];
                candidates.push({ pid, ppid, extensionPort, csrfToken, cmd });
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        // 1. Prefer the process that is a direct child of the current process (extension host)
        const child = candidates.find(c => c.ppid === currentPid);
        if (child) {
            return child;
        }

        // 2. 优先匹配当前 IDE 实例环境路径（例如当前 extension host 所在的 appRoot / 版本目录）
        try {
            const appRoot = vscode.env.appRoot;
            if (appRoot) {
                const parentDir = path.dirname(appRoot);
                const matchAppRoot = candidates.find(c => c.cmd.includes(appRoot) || c.cmd.includes(parentDir));
                if (matchAppRoot) {
                    logger.info('UnixDetector', `Found matching process PID ${matchAppRoot.pid} based on appRoot`);
                    return matchAppRoot;
                }
            }
        } catch {
            // ignore
        }

        // 3. Fallback: 优先选择 PID 最大的候选进程（通常为最新启动的实例）
        const sorted = [...candidates].sort((a, b) => b.pid - a.pid);
        return sorted[0];
    }

    /**
     * Get command to list ports for a specific process.
     * Uses the available command detected by ensurePortCommandAvailable().
     */
    getPortListCommand(pid: number): string {
        switch (this.availablePortCommand) {
            case 'lsof':
                // lsof: -P no port name resolution, -a AND conditions, -n no hostname resolution
                return `lsof -Pan -p ${pid} -i`;
            case 'ss':
                // ss: -t TCP, -l listening, -n numeric, -p show process
                return `ss -tlnp 2>/dev/null | grep "pid=${pid},"`;
            case 'netstat':
                return `netstat -tulpn 2>/dev/null | grep ${pid}`;
            default:
                // Fallback chain if ensurePortCommandAvailable() wasn't called
                return `lsof -Pan -p ${pid} -i 2>/dev/null || ss -tlnp 2>/dev/null | grep "pid=${pid}," || netstat -tulpn 2>/dev/null | grep ${pid}`;
        }
    }

    /**
     * Parse lsof/ss/netstat output to extract listening ports.
     * 
     * lsof format:
     *   language_ 1234 user  10u  IPv4 0x... 0t0  TCP 127.0.0.1:2873 (LISTEN)
     * 
     * ss format (Linux):
     *   LISTEN  0  128  127.0.0.1:2873  0.0.0.0:*  users:(("language_server",pid=1234,fd=10))
     * 
     * netstat format (Linux):
     *   tcp  0  0  127.0.0.1:2873  0.0.0.0:*  LISTEN  1234/language_server
     */
    parseListeningPorts(stdout: string): number[] {
        const ports: number[] = [];

        if (!stdout || stdout.trim().length === 0) {
            return ports;
        }

        const lines = stdout.trim().split('\n');

        for (const line of lines) {
            // Try lsof format: 127.0.0.1:PORT (LISTEN)
            const lsofMatch = line.match(/127\.0\.0\.1:(\d+).*\(LISTEN\)/);
            if (lsofMatch && lsofMatch[1]) {
                const port = parseInt(lsofMatch[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
                continue;
            }

            // Try ss format: 127.0.0.1:PORT or *:PORT in LISTEN state
            // ss output: LISTEN 0 128 127.0.0.1:2873 0.0.0.0:*
            const ssMatch = line.match(/LISTEN\s+\d+\s+\d+\s+(?:127\.0\.0\.1|\*):(\d+)/);
            if (ssMatch && ssMatch[1]) {
                const port = parseInt(ssMatch[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
                continue;
            }

            // Try netstat format: 127.0.0.1:PORT ... LISTEN
            const netstatMatch = line.match(/127\.0\.0\.1:(\d+).*LISTEN/);
            if (netstatMatch && netstatMatch[1]) {
                const port = parseInt(netstatMatch[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
                continue;
            }

            // Also try localhost format (for lsof/netstat)
            const localhostMatch = line.match(/localhost:(\d+).*\(LISTEN\)|localhost:(\d+).*LISTEN/);
            if (localhostMatch) {
                const port = parseInt(localhostMatch[1] || localhostMatch[2], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
            }
        }

        return ports.sort((a, b) => a - b);
    }

    /**
     * Get Unix-specific error messages.
     */
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    } {
        const processName = this.platform === 'darwin'
            ? 'language_server_macos'
            : 'language_server_linux';

        return {
            processNotFound: 'language_server process not found',
            commandNotAvailable: 'ps/lsof commands are unavailable; please check the system environment',
            requirements: [
                'Antigravity is running',
                `${processName} process is running`,
                'The system has permission to execute ps and lsof commands'
            ]
        };
    }
}
