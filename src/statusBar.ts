/**
 * Status bar service
 */

import * as vscode from 'vscode';
import { ModelQuotaInfo, QuotaLevel, QuotaSnapshot } from './types';

export class StatusBarService {
  private statusBarItem: vscode.StatusBarItem;
  private warningThreshold: number;
  private criticalThreshold: number;
  private showPromptCredits: boolean;
  private displayStyle: 'percentage' | 'progressBar';
  private lastSnapshot?: QuotaSnapshot;
  private isQuickRefreshing: boolean = false;

  constructor(
    warningThreshold: number = 50,
    criticalThreshold: number = 30,
    showPromptCredits: boolean = false,
    displayStyle: 'percentage' | 'progressBar' = 'progressBar'
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'antigravity-quota-watcher.showQuota';
    this.warningThreshold = warningThreshold;
    this.criticalThreshold = criticalThreshold;
    this.showPromptCredits = showPromptCredits;
    this.displayStyle = displayStyle;
  }

  updateDisplay(snapshot: QuotaSnapshot): void {
    // 保存最后的快照
    this.lastSnapshot = snapshot;
    // 清除刷新状态
    this.isQuickRefreshing = false;
    // 设置为快速刷新命令,允许用户点击立即刷新
    this.statusBarItem.command = 'antigravity-quota-watcher.quickRefreshQuota';

    const parts: string[] = [];

    if (this.showPromptCredits && snapshot.promptCredits) {
      const { available, monthly, remainingPercentage } = snapshot.promptCredits;
      const indicator = this.getStatusIndicator(remainingPercentage);
      const creditsPart = `${indicator} 💳 ${available}/${this.formatNumber(monthly)} (${remainingPercentage.toFixed(0)}%)`;
      parts.push(creditsPart);
    }

    const modelsToShow = this.selectModelsToDisplay(snapshot.models);

    for (const model of modelsToShow) {
      const emoji = this.getModelEmoji(model.label);
      const shortName = this.getShortModelName(model.label);
      const indicator = this.getStatusIndicator(model.remainingPercentage ?? 0);

      if (model.isExhausted) {
        if (this.displayStyle === 'progressBar') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(0)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName}: 0%`);
        }
      } else if (model.remainingPercentage !== undefined) {
        if (this.displayStyle === 'progressBar') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(model.remainingPercentage)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName}: ${model.remainingPercentage.toFixed(0)}%`);
        }
      }
    }

    if (parts.length === 0) {
      this.statusBarItem.text = '$(warning) Antigravity: Unable to fetch quota';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = 'Cannot connect to Antigravity Language Server';
    } else {
      const displayText = parts.join('  ');
      this.statusBarItem.text = displayText;
      // 移除背景色变化，保持默认
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.color = undefined;
      this.updateTooltip(snapshot);
    }

    this.statusBarItem.show();
  }

  /**
   * 根据剩余百分比返回状态指示符号
   * 🟢 > warningThreshold (默认50%)
   * 🟡 criticalThreshold < percentage <= warningThreshold (默认30%-50%)
   * 🔴 0 < percentage <= criticalThreshold (默认<30%)
   * ⚫ percentage <= 0
   */
  private getStatusIndicator(percentage: number): string {
    if (percentage <= 0) {
      return '⚫'; // Depleted
    } else if (percentage <= this.criticalThreshold) {
      return '🔴'; // Critical
    } else if (percentage <= this.warningThreshold) {
      return '🟡'; // Warning
    }
    return '🟢'; // Normal
  }

  setWarningThreshold(threshold: number): void {
    this.warningThreshold = threshold;
  }

  setCriticalThreshold(threshold: number): void {
    this.criticalThreshold = threshold;
  }

  setShowPromptCredits(value: boolean): void {
    this.showPromptCredits = value;
  }

  setDisplayStyle(value: 'percentage' | 'progressBar'): void {
    this.displayStyle = value;
  }

  private updateTooltip(snapshot: QuotaSnapshot): void {
    const lines: string[] = ['Antigravity model quota details', ''];

    if (this.showPromptCredits && snapshot.promptCredits) {
      lines.push('💳 Prompt Credits');
      lines.push(`  Available: ${snapshot.promptCredits.available} / ${snapshot.promptCredits.monthly}`);
      lines.push(`  Remaining: ${snapshot.promptCredits.remainingPercentage.toFixed(1)}%`);
      lines.push('');
    }

    for (const model of snapshot.models) {
      const emoji = this.getModelEmoji(model.label);
      lines.push(`${emoji} ${model.label}`);

      if (model.isExhausted) {
        lines.push('  ⚠️ Quota depleted');
      } else if (model.remainingPercentage !== undefined) {
        lines.push(`  Remaining: ${model.remainingPercentage.toFixed(1)}%`);
      }

      lines.push(`  Reset time: ${model.timeUntilResetFormatted}`);
      lines.push('');
    }

    this.statusBarItem.tooltip = lines.join('\n');
  }

  private selectModelsToDisplay(models: ModelQuotaInfo[]): ModelQuotaInfo[] {
    const result: ModelQuotaInfo[] = [];

    const proLow = models.find(model => this.isProLow(model.label));
    if (proLow) {
      result.push(proLow);
    }

    const claude = models.find(model => this.isClaudeWithoutThinking(model.label));
    if (claude && claude !== proLow) {
      result.push(claude);
    }

    for (const model of models) {
      if (result.length >= 2) break;
      if (!result.includes(model)) {
        result.push(model);
      }
    }

    return result.slice(0, 2);
  }

  private isProLow(label: string): boolean {
    const lower = label.toLowerCase();
    return lower.includes('pro') && lower.includes('low');
  }

  private isClaudeWithoutThinking(label: string): boolean {
    const lower = label.toLowerCase();
    return lower.includes('claude') && !lower.includes('thinking');
  }

  private formatNumber(num: number): string {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}k`;
    }
    return num.toString();
  }

  private getModelEmoji(label: string): string {
    if (label.includes('Claude')) {
      return '';
    }
    if (label.includes('Gemini') && label.includes('Flash')) {
      return '';
    }
    if (label.includes('Gemini') && label.includes('Pro')) {
      return '';
    }
    if (label.includes('GPT')) {
      return '';
    }
    return '';
  }

  private getShortModelName(label: string): string {
    if (label.includes('Claude')) {
      return 'Claude';
    }
    if (label.includes('Flash')) {
      return 'Flash';
    }
    if (label.includes('Pro (High)')) {
      return 'Pro-H';
    }
    if (label.includes('Pro (Low)')) {
      return 'Pro-L';
    }
    if (label.includes('Pro')) {
      return 'Pro';
    }
    if (label.includes('GPT')) {
      return 'GPT';
    }

    return label.split(' ')[0];
  }

  private getProgressBar(percentage: number, width: number = 8): string {
    // 确保百分比在 0-100 之间
    const p = Math.max(0, Math.min(100, percentage));
    // 计算填充的块数
    const filledCount = Math.round((p / 100) * width);
    const emptyCount = width - filledCount;

    const filled = '█'.repeat(filledCount);
    const empty = '░'.repeat(emptyCount);

    return `${filled}${empty}`;
  }

  /**
   * 显示快速刷新状态 - 在当前配额显示前添加刷新图标
   */
  showQuickRefreshing(): void {
    if (this.isQuickRefreshing) {
      return; // 已经在刷新状态
    }
    this.isQuickRefreshing = true;

    // 在当前文本前添加刷新图标
    const currentText = this.statusBarItem.text;
    if (!currentText.startsWith('$(sync~spin)')) {
      this.statusBarItem.text = `$(sync~spin) ${currentText}`;
    }
    this.statusBarItem.tooltip = 'Refreshing quota...\n\n' + (this.statusBarItem.tooltip || '');
    this.statusBarItem.show();
  }

  showDetecting(): void {
    this.statusBarItem.text = '🔍 Detecting port...';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = 'Detecting Antigravity process ports...';
    this.statusBarItem.show();
  }

  showInitializing(): void {
    this.statusBarItem.text = '⏳ Initializing...';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = 'Initializing quota monitoring service...';
    this.statusBarItem.show();
  }

  showFetching(): void {
    this.statusBarItem.text = '$(sync~spin) Fetching quota...';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = 'Fetching quota information from Antigravity...';
    this.statusBarItem.show();
  }

  showRetrying(currentRetry: number, maxRetries: number): void {
    this.statusBarItem.text = `$(sync~spin) Retrying (${currentRetry}/${maxRetries})...`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.tooltip = `Quota fetch failed; running retry ${currentRetry} of ${maxRetries}...`;
    this.statusBarItem.show();
  }

  showError(message: string): void {
    this.statusBarItem.text = '$(error) Antigravity Quota Watcher: Error';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.tooltip = `${message}\n\nClick to retry fetching quota`;
    // 修改命令为刷新配额
    this.statusBarItem.command = 'antigravity-quota-watcher.refreshQuota';
    this.statusBarItem.show();
  }

  clearError(): void {
    this.statusBarItem.text = '$(sync~spin) Antigravity Quota Watcher: Loading...';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = 'Fetching quota information...';
    this.statusBarItem.show();
  }

  showNotLoggedIn(): void {
    this.statusBarItem.text = '$(account) Not logged in to Antigravity';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.statusBarItem.tooltip = 'Sign in to your Google account to view model quota information\n\nClick to recheck login status';
    // 修改命令为重新检测
    this.statusBarItem.command = 'antigravity-quota-watcher.retryLoginCheck';
    this.statusBarItem.show();
  }

  show(): void {
    this.statusBarItem.show();
  }

  hide(): void {
    this.statusBarItem.hide();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
