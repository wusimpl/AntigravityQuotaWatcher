/**
 * Platform detection and strategy selection.
 * Provides platform-specific implementations for process detection.
 */

import * as vscode from 'vscode';
import { WindowsProcessDetector } from './windowsProcessDetector';
import { UnixProcessDetector } from './unixProcessDetector';

/**
 * Platform-specific strategy interface for process detection.
 */
export interface IPlatformStrategy {
    /**
     * Get the command to list processes with their command line arguments.
     * @param processName Name of the process to search for
     * @returns Shell command string
     */
    getProcessListCommand(processName: string): string;

    /**
     * Parse the output of process list command to extract process info.
     * @param stdout Output from the process list command
     * @returns Parsed process info or null if not found
     */
    parseProcessInfo(stdout: string): {
        pid: number;
        extensionPort: number;
        csrfToken: string;
    } | null;

    /**
     * Get the command to list ports listened by a specific process.
     * @param pid Process ID
     * @returns Shell command string
     */
    getPortListCommand(pid: number): string;

    /**
     * Parse the output of port list command to extract listening ports.
     * @param stdout Output from the port list command
     * @returns Array of port numbers
     */
    parseListeningPorts(stdout: string): number[];

    /**
     * Get platform-specific error messages.
     */
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    };
}

/**
 * Platform detector that selects the appropriate strategy based on the current OS.
 */
export class PlatformDetector {
    private platform: NodeJS.Platform;

    constructor() {
        this.platform = process.platform;
    }

    /**
     * Get the name of the language server process for the current platform.
     */
    getProcessName(): string {
        switch (this.platform) {
            case 'win32':
                return 'language_server_windows_x64.exe';
            case 'darwin':
                return 'language_server_macos';
            case 'linux':
                return 'language_server_linux';
            default:
                throw new Error(`Unsupported platform: ${this.platform}`);
        }
    }

    /**
     * Get the platform-specific detection strategy.
     */
    getStrategy(): IPlatformStrategy {
        switch (this.platform) {
            case 'win32':
                const windowsDetector = new WindowsProcessDetector();

                // 读取用户配置，检查是否强制使用 PowerShell 模式
                const config = vscode.workspace.getConfiguration('antigravityQuotaWatcher');
                const forcePowerShell = config.get<boolean>('forcePowerShell', false);

                if (forcePowerShell) {
                    console.log('🔧 Configuration: forcePowerShell is enabled, using PowerShell mode');
                    windowsDetector.setUsePowerShell(true);
                }

                return windowsDetector;
            case 'darwin':
            case 'linux':
                return new UnixProcessDetector(this.platform);
            default:
                throw new Error(`Unsupported platform: ${this.platform}`);
        }
    }

    /**
     * Get the current platform name for display.
     */
    getPlatformName(): string {
        switch (this.platform) {
            case 'win32':
                return 'Windows';
            case 'darwin':
                return 'macOS';
            case 'linux':
                return 'Linux';
            default:
                return this.platform;
        }
    }
}
