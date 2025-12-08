/**
 * 配置管理服务
 */

import * as vscode from 'vscode';
import { Config } from './types';

export class ConfigService {
  private readonly configKey = 'antigravityQuotaWatcher';

  /**
   * 获取完整配置
   */
  getConfig(): Config {
    const config = vscode.workspace.getConfiguration(this.configKey);
    return {
      enabled: config.get<boolean>('enabled', true),
      pollingInterval: Math.max(10, config.get<number>('pollingInterval', 60)) * 1000,
      warningThreshold: config.get<number>('warningThreshold', 50),
      criticalThreshold: config.get<number>('criticalThreshold', 30),
      apiMethod: (config.get<string>('apiMethod', 'GET_USER_STATUS') as Config['apiMethod']),
      showPromptCredits: config.get<boolean>('showPromptCredits', false),
      showPlanName: config.get<boolean>('showPlanName', false),
      displayStyle: (config.get<string>('displayStyle', 'progressBar') as Config['displayStyle']),
      language: (config.get<string>('language', 'auto') as Config['language'])
    };
  }

  /**
   * 获取轮询间隔
   */
  getPollingInterval(): number {
    return this.getConfig().pollingInterval;
  }

  /**
   * 获取预警阈值
   */
  getWarningThreshold(): number {
    return this.getConfig().warningThreshold;
  }

  /**
   * 获取临界阈值
   */
  getCriticalThreshold(): number {
    return this.getConfig().criticalThreshold;
  }

  /**
   * 获取接口选择
   */
  getApiMethod(): Config['apiMethod'] {
    return this.getConfig().apiMethod;
  }

  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  /**
   * 监听配置变更
   */
  onConfigChange(callback: (config: Config) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(this.configKey)) {
        callback(this.getConfig());
      }
    });
  }
}
