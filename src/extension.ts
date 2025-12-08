/**
 * Antigravity Quota Watcher - main extension file
 */

import * as vscode from 'vscode';
import { QuotaService, QuotaApiMethod } from './quotaService';
import { StatusBarService } from './statusBar';
import { ConfigService } from './configService';
import { PortDetectionService, PortDetectionResult } from './portDetectionService';
import { Config, QuotaSnapshot } from './types';
import { LocalizationService } from './i18n/localizationService';

let quotaService: QuotaService | undefined;
let statusBarService: StatusBarService | undefined;
let configService: ConfigService | undefined;
let portDetectionService: PortDetectionService | undefined;
let configChangeTimer: NodeJS.Timeout | undefined;  // 配置变更防抖定时器

/**
 * Called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Antigravity Quota Watcher activated');

  // Init services
  configService = new ConfigService();
  let config = configService.getConfig();

  // Initialize localization
  const localizationService = LocalizationService.getInstance();
  localizationService.setLanguage(config.language);

  // console.log('[Extension] Loaded config:', config);

  portDetectionService = new PortDetectionService(context);

  // Init status bar
  statusBarService = new StatusBarService(
    config.warningThreshold,
    config.criticalThreshold,
    config.showPromptCredits,
    config.displayStyle
  );
  // 显示检测状态
  statusBarService.showDetecting();

  // Auto detect port and csrf token
  let detectedPort: number | null = null;
  let detectedCsrfToken: string | null = null;
  let detectionResult: PortDetectionResult | null = null;

  try {
    console.log('[Extension] Starting initial port detection');
    const result = await portDetectionService.detectPort();
    if (result) {
      detectionResult = result;
      detectedPort = result.port;
      detectedCsrfToken = result.csrfToken;
      console.log('[Extension] Initial port detection success:', detectionResult);
    }
  } catch (error) {
    console.error('❌ Port/CSRF detection failed', error);
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  // Ensure port and CSRF token are available
  if (!detectedPort || !detectedCsrfToken) {
    console.error('Missing port or CSRF Token, extension cannot start');
    console.error('Please ensure Antigravity language server is running');
    statusBarService.showError('Port/CSRF Detection failed, Please try restart.');
    statusBarService.show();

    // 显示用户提示,提供重试选项
    vscode.window.showWarningMessage(
      'Antigravity Quota Watcher: Unable to detect the Antigravity process.',
      'Retry',
      'Cancel'
    ).then(action => {
      if (action === 'Retry') {
        vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
      }
    });
  } else {
    // 显示初始化状态
    statusBarService.showInitializing();

    // Init quota service
    quotaService = new QuotaService(detectedPort, undefined, detectionResult?.httpPort);
    // Set ports for HTTPS + HTTP fallback
    quotaService.setPorts(detectionResult?.connectPort ?? detectedPort, detectionResult?.httpPort);
    // Choose endpoint based on config
    quotaService.setApiMethod(config.apiMethod === 'COMMAND_MODEL_CONFIG'
      ? QuotaApiMethod.COMMAND_MODEL_CONFIG
      : QuotaApiMethod.GET_USER_STATUS);

    // Register quota update callback
    quotaService.onQuotaUpdate((snapshot: QuotaSnapshot) => {
      statusBarService?.updateDisplay(snapshot);
    });

    // Register error callback (silent, only update status bar)
    quotaService.onError((error: Error) => {
      console.error('Quota fetch failed:', error);
      statusBarService?.showError(`Connection failed: ${error.message}`);
    });

    // Register status callback
    quotaService.onStatus((status: 'fetching' | 'retrying', retryCount?: number) => {
      if (status === 'fetching') {
        statusBarService?.showFetching();
      } else if (status === 'retrying' && retryCount !== undefined) {
        statusBarService?.showRetrying(retryCount, 3); // MAX_RETRY_COUNT = 3
      }
    });

    // If enabled, start polling after a short delay
    if (config.enabled) {
      console.log('Starting quota polling after delay...');

      // 显示准备获取配额的状态
      statusBarService.showFetching();

      setTimeout(() => {
        quotaService?.setAuthInfo(undefined, detectedCsrfToken);
        quotaService?.startPolling(config.pollingInterval);
      }, 8000);

      statusBarService.show();
    }
  }

  // Command: show quota details (placeholder)
  const showQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.showQuota',
    () => {
      // TODO: implement quota detail panel
    }
  );

  // Command: quick refresh quota (for success state)
  const quickRefreshQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.quickRefreshQuota',
    async () => {
      console.log('[Extension] quickRefreshQuota command invoked');
      if (!quotaService) {
        vscode.window.showWarningMessage('Quota service is not initialized');
        return;
      }

      console.log('User triggered quick quota refresh');
      // 显示刷新中状态(旋转图标)
      statusBarService?.showQuickRefreshing();
      // 立即刷新一次,不中断轮询
      await quotaService.quickRefresh();
    }
  );

  // Command: refresh quota
  const refreshQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.refreshQuota',
    async () => {
      console.log('[Extension] refreshQuota command invoked');
      if (!quotaService) {
        vscode.window.showWarningMessage('Quota service is not initialized');
        return;
      }

      vscode.window.showInformationMessage('🔄 Refreshing quota...');
      config = configService!.getConfig();
      statusBarService?.setWarningThreshold(config.warningThreshold);
      statusBarService?.setCriticalThreshold(config.criticalThreshold);
      statusBarService?.setShowPromptCredits(config.showPromptCredits);
      statusBarService?.setDisplayStyle(config.displayStyle);
      statusBarService?.showFetching();

      if (config.enabled) {
        quotaService.setApiMethod(config.apiMethod === 'COMMAND_MODEL_CONFIG'
          ? QuotaApiMethod.COMMAND_MODEL_CONFIG
          : QuotaApiMethod.GET_USER_STATUS);
        // 使用新的重试方法,成功后会自动恢复轮询
        await quotaService.retryFromError(config.pollingInterval);
      }
    }
  );

  // Command: retry login check
  const retryLoginCheckCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.retryLoginCheck',
    async () => {
      console.log('[Extension] retryLoginCheck command invoked');
      if (!quotaService) {
        vscode.window.showWarningMessage('Quota service is not initialized, please detect the port first');
        return;
      }

      vscode.window.showInformationMessage('🔄 Rechecking login status...');
      statusBarService?.showFetching();

      // 立即触发一次配额获取，会自动检测登录状态
      await quotaService.stopPolling();

      // 使用 setTimeout 确保有足够时间让用户登录
      setTimeout(() => {
        if (config.enabled && quotaService) {
          quotaService.startPolling(config.pollingInterval);
        }
      }, 1000);
    }
  );

  // Command: re-detect port
  const detectPortCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.detectPort',
    async () => {
      console.log('[Extension] detectPort command invoked');
      vscode.window.showInformationMessage('🔍 Detecting port again...');

      config = configService!.getConfig();
      statusBarService?.setWarningThreshold(config.warningThreshold);
      statusBarService?.setCriticalThreshold(config.criticalThreshold);
      statusBarService?.setShowPromptCredits(config.showPromptCredits);
      statusBarService?.setDisplayStyle(config.displayStyle);

      try {
        console.log('[Extension] detectPort: invoking portDetectionService');
        const result = await portDetectionService?.detectPort();

        if (result && result.port && result.csrfToken) {
          console.log('[Extension] detectPort command succeeded:', result);
          // 如果之前没有 quotaService,需要初始化
          if (!quotaService) {
            quotaService = new QuotaService(result.port, result.csrfToken, result.httpPort);
            quotaService.setPorts(result.connectPort, result.httpPort);

            // 注册回调
            quotaService.onQuotaUpdate((snapshot: QuotaSnapshot) => {
              statusBarService?.updateDisplay(snapshot);
            });

            quotaService.onError((error: Error) => {
              console.error('Quota fetch failed:', error);
              statusBarService?.showError(`Connection failed: ${error.message}`);
            });

          } else {
            // 更新现有服务的端口
            quotaService.setPorts(result.connectPort, result.httpPort);
            quotaService.setAuthInfo(undefined, result.csrfToken);
            console.log('[Extension] detectPort: updated existing QuotaService ports');
          }

          // 清除之前的错误状态
          statusBarService?.clearError();

          quotaService.stopPolling();
          quotaService.setApiMethod(config.apiMethod === 'COMMAND_MODEL_CONFIG'
            ? QuotaApiMethod.COMMAND_MODEL_CONFIG
            : QuotaApiMethod.GET_USER_STATUS);
          quotaService.startPolling(config.pollingInterval);

          vscode.window.showInformationMessage(`✅ Detection successful! Port: ${result.port}`);
        } else {
          console.warn('[Extension] detectPort command did not return valid ports');
          vscode.window.showErrorMessage(
            '❌ Unable to detect a valid port. Please ensure:\n' +
            '1. Your Google account is signed in\n' +
            '2. The system has permission to run the detection commands'
          );
        }
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Port detection failed:', errorMsg);
        if (error?.stack) {
          console.error('Stack:', error.stack);
        }
        vscode.window.showErrorMessage(`❌ Port detection failed: ${errorMsg}`);
      }
    }
  );

  // Listen to config changes
  const configChangeDisposable = configService.onConfigChange((newConfig) => {
    handleConfigChange(newConfig as Config);
  });

  // Add to context subscriptions
  context.subscriptions.push(
    showQuotaCommand,
    quickRefreshQuotaCommand,
    refreshQuotaCommand,
    retryLoginCheckCommand,
    detectPortCommand,
    configChangeDisposable,
    { dispose: () => quotaService?.dispose() },
    { dispose: () => statusBarService?.dispose() }
  );

  // Startup log
  console.log('Antigravity Quota Watcher initialized');
}

/**
 * Handle config changes with debounce to prevent race conditions
 */
function handleConfigChange(config: Config): void {
  // 防抖：300ms 内的多次变更只执行最后一次
  if (configChangeTimer) {
    clearTimeout(configChangeTimer);
  }

  configChangeTimer = setTimeout(() => {
    console.log('Config updated (debounced)', config);

    quotaService?.setApiMethod(config.apiMethod === 'COMMAND_MODEL_CONFIG'
      ? QuotaApiMethod.COMMAND_MODEL_CONFIG
      : QuotaApiMethod.GET_USER_STATUS);
    statusBarService?.setWarningThreshold(config.warningThreshold);
    statusBarService?.setCriticalThreshold(config.criticalThreshold);
    statusBarService?.setShowPromptCredits(config.showPromptCredits);
    statusBarService?.setDisplayStyle(config.displayStyle);

    // Update language
    const localizationService = LocalizationService.getInstance();
    if (localizationService.getLanguage() !== config.language) {
      localizationService.setLanguage(config.language);
      // Refresh display to reflect language change
      quotaService?.quickRefresh();
    }

    if (config.enabled) {
      quotaService?.startPolling(config.pollingInterval);
      statusBarService?.show();
    } else {
      quotaService?.stopPolling();
      statusBarService?.hide();
    }

    vscode.window.showInformationMessage('Antigravity Quota Watcher config updated');
  }, 300);
}

/**
 * Called when the extension is deactivated
 */
export function deactivate() {
  console.log('Antigravity Quota Watcher deactivated');
  quotaService?.dispose();
  statusBarService?.dispose();
}
