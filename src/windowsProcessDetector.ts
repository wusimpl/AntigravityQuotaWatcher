/**
 * Windows-specific process detection implementation.
 * Uses wmic (fallback to PowerShell if unavailable) and netstat commands.
 * 
 * Security Note: PowerShell path is resolved using SafePowerShellPath which
 * implements a controlled search order to prevent path hijacking attacks.
 * See safePowerShellPath.ts for details.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IPlatformStrategy } from './platformDetector';
import { SafePowerShellPath } from './safePowerShellPath';
import { logger } from './logger';

export class WindowsProcessDetector implements IPlatformStrategy {
    private static readonly SYSTEM_ROOT: string = process.env.SystemRoot || 'C:\\Windows';
    private static readonly WMIC_PATH: string = `"${WindowsProcessDetector.SYSTEM_ROOT}\\System32\\wbem\\wmic.exe"`;
    private static readonly NETSTAT_PATH: string = `"${WindowsProcessDetector.SYSTEM_ROOT}\\System32\\netstat.exe"`;
    private static readonly FINDSTR_PATH: string = `"${WindowsProcessDetector.SYSTEM_ROOT}\\System32\\findstr.exe"`;

    private usePowerShell: boolean = true;

    /**
     * 设置是否使用 PowerShell 模式
     * 当 WMIC 不可用时(Windows 10 21H1+ / Windows 11),自动降级到 PowerShell
     */
    setUsePowerShell(value: boolean): void {
        this.usePowerShell = value;
    }

    /**
     * 获取是否使用 PowerShell 模式
     */
    isUsingPowerShell(): boolean {
        return this.usePowerShell;
    }

    /**
     * Get command to list Windows processes.
     * 优先使用 wmic,如果不可用则使用 PowerShell
     */
    getProcessListCommand(_processName: string): string {
        if (this.usePowerShell) {
            // PowerShell 命令:使用 Get-CimInstance 获取进程信息并输出 JSON
            // 使用 SafePowerShellPath 获取安全的 PowerShell 路径，防止路径劫持攻击
            // 使用 like 匹配兼容 x64 与 arm64
            const psPath = SafePowerShellPath.getSafePath();
            return `${psPath} -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like 'language_server_windows%'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
        } else {
            // WMIC 命令(传统方式)
            return `${WindowsProcessDetector.WMIC_PATH} process where "name like 'language_server_windows%'" get ProcessId,CommandLine /format:list`;
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
     * Parse process output to extract process information.
     * 支持 WMIC 和 PowerShell 两种输出格式
     * 
     * WMIC 格式:
     *   CommandLine=...--extension_server_port=1234 --csrf_token=abc123...
     *   ProcessId=5678
     * 
     * PowerShell JSON 格式:
     *   {"ProcessId":5678,"CommandLine":"...--extension_server_port=1234 --csrf_token=abc123..."}
     *   或数组: [{"ProcessId":5678,"CommandLine":"..."}]
     */
    parseProcessInfo(stdout: string): {
        pid: number;
        extensionPort: number;
        csrfToken: string;
    } | null {
        // 尝试解析 PowerShell JSON 输出
        if (this.usePowerShell || stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
            try {
                let data = JSON.parse(stdout.trim());
                // 如果是数组,筛选出 Antigravity 进程
                if (Array.isArray(data)) {
                    if (data.length === 0) {
                        return null;
                    }
                    const totalCount = data.length;
                    // 过滤出 Antigravity 进程
                    const antigravityProcesses = data.filter((item: any) =>
                        item.CommandLine && this.isAntigravityProcess(item.CommandLine)
                    );
                    logger.info('WindowsDetector', `Found ${totalCount} language_server process(es), ${antigravityProcesses.length} belong to Antigravity`);
                    if (antigravityProcesses.length === 0) {
                        logger.info('WindowsDetector', 'No Antigravity process found, skipping non-Antigravity processes');
                        return null;
                    }
                    if (antigravityProcesses.length > 1) {
                        // 优先匹配当前 IDE appRoot 路径
                        let matched = false;
                        try {
                            const appRoot = vscode.env.appRoot;
                            if (appRoot) {
                                const parentDir = path.dirname(appRoot);
                                const match = antigravityProcesses.find((p: any) => p.CommandLine && (p.CommandLine.includes(appRoot) || p.CommandLine.includes(parentDir)));
                                if (match) {
                                    data = match;
                                    matched = true;
                                }
                            }
                        } catch {
                            // ignore appRoot match error
                        }
                        if (!matched) {
                            // 降级：选择 ProcessId 最大的进程（最新启动）
                            const sorted = [...antigravityProcesses].sort((a: any, b: any) => (b.ProcessId || 0) - (a.ProcessId || 0));
                            data = sorted[0];
                        }
                        logger.info('WindowsDetector', `Selected Antigravity process PID: ${data.ProcessId}`);
                    } else {
                        data = antigravityProcesses[0];
                    }
                } else {
                    // 单个对象时也要检查是否是 Antigravity 进程
                    if (!data.CommandLine || !this.isAntigravityProcess(data.CommandLine)) {
                        logger.info('WindowsDetector', 'Single process found but not Antigravity, skipping');
                        return null;
                    }
                    logger.info('WindowsDetector', `Found 1 Antigravity process, PID: ${data.ProcessId}`);
                }

                const commandLine = data.CommandLine || '';
                const pid = data.ProcessId;

                if (!pid) {
                    return null;
                }

                const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
                const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

                if (!tokenMatch || !tokenMatch[1]) {
                    return null;
                }

                const extensionPort = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 0;
                const csrfToken = tokenMatch[1];

                return { pid, extensionPort, csrfToken };
            } catch (e) {
                // JSON 解析失败,记录日志并继续尝试 WMIC 格式
                logger.debug('WindowsDetector', `JSON parse failed, trying WMIC format: ${e}`);
            }
        }

        // 解析 WMIC 输出格式
        // WMIC 输出格式为多个进程块，每个块包含 CommandLine= 和 ProcessId= 行
        // 需要按进程分组处理，避免混淆不同进程的参数
        const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);

        const candidates: Array<{ pid: number; extensionPort: number; csrfToken: string; cmd: string }> = [];

        for (const block of blocks) {
            const pidMatch = block.match(/ProcessId=(\d+)/);
            const commandLineMatch = block.match(/CommandLine=(.+)/);

            if (!pidMatch || !commandLineMatch) {
                continue;
            }

            const commandLine = commandLineMatch[1].trim();

            // 检查是否是 Antigravity 进程
            if (!this.isAntigravityProcess(commandLine)) {
                continue;
            }

            const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

            if (!tokenMatch || !tokenMatch[1]) {
                continue;
            }

            const pid = parseInt(pidMatch[1], 10);
            const extensionPort = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 0;
            const csrfToken = tokenMatch[1];

            candidates.push({ pid, extensionPort, csrfToken, cmd: commandLine });
        }

        if (candidates.length === 0) {
            logger.info('WindowsDetector', 'WMIC: No Antigravity process found');
            return null;
        }

        // 优先匹配 appRoot
        try {
            const appRoot = vscode.env.appRoot;
            if (appRoot) {
                const parentDir = path.dirname(appRoot);
                const match = candidates.find(c => c.cmd.includes(appRoot) || c.cmd.includes(parentDir));
                if (match) {
                    logger.info('WindowsDetector', `WMIC: Found matching process based on appRoot, PID: ${match.pid}`);
                    return match;
                }
            }
        } catch {
            // ignore appRoot match error
        }

        const sorted = [...candidates].sort((a, b) => b.pid - a.pid);
        logger.info('WindowsDetector', `WMIC: Found ${candidates.length} Antigravity process(es), using PID: ${sorted[0].pid}`);
        return sorted[0];
    }

    /**
     * Ensure port detection commands are available.
     * On Windows, netstat is always available as a system command.
     */
    async ensurePortCommandAvailable(): Promise<void> {
        // netstat is a built-in Windows command, always available
        return;
    }

    /**
     * Get command to list ports for a specific process using netstat.
     */
    getPortListCommand(pid: number): string {
        const netstat = WindowsProcessDetector.NETSTAT_PATH;
        const findstr = WindowsProcessDetector.FINDSTR_PATH;
        return `${netstat} -ano | ${findstr} "${pid}" | ${findstr} "LISTENING"`;
    }

    /**
     * Parse netstat output to extract listening ports.
     * Expected formats:
     *   TCP    127.0.0.1:2873         0.0.0.0:0              LISTENING       4412
     *   TCP    0.0.0.0:2873           0.0.0.0:0              LISTENING       4412
     *   TCP    [::1]:2873             [::]:0                 LISTENING       4412
     *   TCP    [::]:2873              [::]:0                 LISTENING       4412
     *   TCP    127.0.0.1:2873         *:*                    LISTENING       4412
     */
    parseListeningPorts(stdout: string): number[] {
        // Match IPv4: 127.0.0.1:port, 0.0.0.0:port
        // Match IPv6: [::1]:port, [::]:port
        // Foreign address can be: 0.0.0.0:0, *:*, [::]:0, etc.
        const portRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?]):(\d+)\s+\S+\s+LISTENING/gi;
        const ports: number[] = [];
        let match;

        while ((match = portRegex.exec(stdout)) !== null) {
            const port = parseInt(match[1], 10);
            if (!ports.includes(port)) {
                ports.push(port);
            }
        }

        return ports.sort((a, b) => a - b);
    }

    /**
     * Get Windows-specific error messages.
     */
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    } {
        return {
            processNotFound: 'language_server process not found',
            commandNotAvailable: this.usePowerShell
                ? 'PowerShell command failed; please check system permissions'
                : 'wmic/PowerShell command unavailable; please check the system environment',
            requirements: [
                'Antigravity is running',
                'language_server_windows_x64.exe process is running',
                this.usePowerShell
                    ? 'The system has permission to run PowerShell and netstat commands'
                    : 'The system has permission to run wmic/PowerShell and netstat commands (auto-fallback supported)'
            ]
        };
    }
}

