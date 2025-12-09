/**
 * Version information service for Antigravity Quota Watcher.
 * Provides access to IDE version, extension version, and other version-related info.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface VersionInfo {
    /** Extension version from package.json */
    extensionVersion: string;
    /** IDE name (e.g., "Antigravity", "Visual Studio Code") */
    ideName: string;
    /** IDE version (e.g., "1.11.2" for Antigravity) */
    ideVersion: string;
    /** VS Code OSS version (e.g., "1.104.0") */
    vscodeOssVersion: string;
    /** Operating system (e.g., "windows", "darwin", "linux") */
    os: string;
}

class VersionInfoService {
    private static instance: VersionInfoService;
    private versionInfo: VersionInfo | null = null;

    private constructor() { }

    static getInstance(): VersionInfoService {
        if (!VersionInfoService.instance) {
            VersionInfoService.instance = new VersionInfoService();
        }
        return VersionInfoService.instance;
    }

    /**
     * Initialize version info with extension context.
     * Must be called once during extension activation.
     */
    initialize(context: vscode.ExtensionContext): void {
        const extensionVersion = context.extension.packageJSON.version || 'unknown';
        const ideName = vscode.env.appName || 'unknown';
        const vscodeOssVersion = vscode.version || 'unknown';

        // Read IDE version from product.json
        let ideVersion = 'unknown';
        try {
            const productJsonPath = path.join(vscode.env.appRoot, 'product.json');
            if (fs.existsSync(productJsonPath)) {
                const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
                ideVersion = productJson.ideVersion || productJson.version || 'unknown';
            }
        } catch (e) {
            console.warn('[VersionInfo] Failed to read product.json:', e);
        }

        // Detect OS
        let os = 'unknown';
        switch (process.platform) {
            case 'win32':
                os = 'windows';
                break;
            case 'darwin':
                os = 'darwin';
                break;
            case 'linux':
                os = 'linux';
                break;
            default:
                os = process.platform;
        }

        this.versionInfo = {
            extensionVersion,
            ideName,
            ideVersion,
            vscodeOssVersion,
            os,
        };

        console.log(`[VersionInfo] Initialized: ${this.getFullVersionString()}`);
    }

    /**
     * Get version info. Throws if not initialized.
     */
    getVersionInfo(): VersionInfo {
        if (!this.versionInfo) {
            throw new Error('VersionInfoService not initialized. Call initialize() first.');
        }
        return this.versionInfo;
    }

    /**
     * Get IDE version string (e.g., "1.11.2").
     * Returns "unknown" if not initialized.
     */
    getIdeVersion(): string {
        return this.versionInfo?.ideVersion || 'unknown';
    }

    /**
     * Get IDE name (e.g., "Antigravity").
     */
    getIdeName(): string {
        return this.versionInfo?.ideName || 'unknown';
    }

    /**
     * Get extension version string (e.g., "0.7.6").
     */
    getExtensionVersion(): string {
        return this.versionInfo?.extensionVersion || 'unknown';
    }

    /**
     * Get OS string for API requests (e.g., "windows").
     */
    getOs(): string {
        return this.versionInfo?.os || 'unknown';
    }

    /**
     * Get a formatted version string for logging.
     */
    getFullVersionString(): string {
        const info = this.versionInfo;
        if (!info) {
            return 'VersionInfo not initialized';
        }
        return `Extension v${info.extensionVersion} on ${info.ideName} v${info.ideVersion} (VSCode OSS v${info.vscodeOssVersion})`;
    }
}

// Export singleton instance
export const versionInfo = VersionInfoService.getInstance();
