/**
 * Windows-specific process detection implementation.
 * Uses wmic (fallback to PowerShell if unavailable) and netstat commands.
 */

import { IPlatformStrategy } from './platformDetector';

export class WindowsProcessDetector implements IPlatformStrategy {
    private static readonly SYSTEM_ROOT: string = process.env.SystemRoot || 'C:\\Windows';
    private static readonly POWERSHELL_PATH: string = `"${WindowsProcessDetector.SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"`;
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
    getProcessListCommand(processName: string): string {
        if (this.usePowerShell) {
            // PowerShell 命令:使用 Get-CimInstance 获取进程信息并输出 JSON
            return `${WindowsProcessDetector.POWERSHELL_PATH} -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='${processName}'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
        } else {
            // WMIC 命令(传统方式)
            return `${WindowsProcessDetector.WMIC_PATH} process where "name='${processName}'" get ProcessId,CommandLine /format:list`;
        }
    }

    /**
     * 判断命令行是否属于 Antigravity 进程
     * 通过 --app_data_dir antigravity 或路径中包含 antigravity 来识别
     */
    private isAntigravityProcess(commandLine: string): boolean {
        const lowerCmd = commandLine.toLowerCase();
        // 检查 --app_data_dir antigravity 参数
        if (/--app_data_dir\s+antigravity\b/i.test(commandLine)) {
            return true;
        }
        // 检查路径中是否包含 antigravity
        if (lowerCmd.includes('\\antigravity\\') || lowerCmd.includes('/antigravity/')) {
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
                    console.log(`[WindowsProcessDetector] Found ${totalCount} language_server process(es), ${antigravityProcesses.length} belong to Antigravity`);
                    if (antigravityProcesses.length === 0) {
                        console.log('[WindowsProcessDetector] No Antigravity process found, skipping non-Antigravity processes');
                        return null;
                    }
                    if (totalCount > 1) {
                        console.log(`[WindowsProcessDetector] Selected Antigravity process PID: ${antigravityProcesses[0].ProcessId}`);
                    }
                    data = antigravityProcesses[0];
                } else {
                    // 单个对象时也要检查是否是 Antigravity 进程
                    if (!data.CommandLine || !this.isAntigravityProcess(data.CommandLine)) {
                        console.log('[WindowsProcessDetector] Single process found but not Antigravity, skipping');
                        return null;
                    }
                    console.log(`[WindowsProcessDetector] Found 1 Antigravity process, PID: ${data.ProcessId}`);
                }

                const commandLine = data.CommandLine || '';
                const pid = data.ProcessId;

                if (!pid) {
                    return null;
                }

                const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
                const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

                if (!tokenMatch || !tokenMatch[1]) {
                    return null;
                }

                const extensionPort = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 0;
                const csrfToken = tokenMatch[1];

                return { pid, extensionPort, csrfToken };
            } catch (e) {
                // JSON 解析失败,继续尝试 WMIC 格式
            }
        }

        // 解析 WMIC 输出格式
        // WMIC 输出格式为多个进程块，每个块包含 CommandLine= 和 ProcessId= 行
        // 需要按进程分组处理，避免混淆不同进程的参数
        const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);
        
        const candidates: Array<{ pid: number; extensionPort: number; csrfToken: string }> = [];
        
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
            const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);
            
            if (!tokenMatch || !tokenMatch[1]) {
                continue;
            }
            
            const pid = parseInt(pidMatch[1], 10);
            const extensionPort = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 0;
            const csrfToken = tokenMatch[1];
            
            candidates.push({ pid, extensionPort, csrfToken });
        }
        
        if (candidates.length === 0) {
            console.log('[WindowsProcessDetector] WMIC: No Antigravity process found');
            return null;
        }
        
        console.log(`[WindowsProcessDetector] WMIC: Found ${candidates.length} Antigravity process(es), using PID: ${candidates[0].pid}`);
        return candidates[0];
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
        const portRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)\s+\S+\s+LISTENING/gi;
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

