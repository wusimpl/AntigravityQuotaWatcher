/**
 * Status bar service
 */

import * as vscode from 'vscode';
import { ModelQuotaInfo, QuotaLevel, QuotaSnapshot, PaceStatus } from './types';
import { LocalizationService } from './i18n/localizationService';

export class StatusBarService {
  private statusBarItem: vscode.StatusBarItem;
  private warningThreshold: number;
  private criticalThreshold: number;
  private showPromptCredits: boolean;
  private showPlanName: boolean;
  private displayStyle: 'percentage' | 'progressBar' | 'dots';
  private localizationService: LocalizationService;
  private showUsagePaceTracking: boolean;

  private isQuickRefreshing: boolean = false;
  private refreshStartTime: number = 0;
  private readonly minRefreshDuration: number = 1000;

  constructor(
    warningThreshold: number = 50,
    criticalThreshold: number = 30,
    showPromptCredits: boolean = false,
    showPlanName: boolean = false,
    displayStyle: 'percentage' | 'progressBar' | 'dots' = 'progressBar',
    showUsagePaceTracking: boolean = true
  ) {
    this.localizationService = LocalizationService.getInstance();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'antigravity-quota-watcher.showQuota';
    this.warningThreshold = warningThreshold;
    this.criticalThreshold = criticalThreshold;
    this.showPromptCredits = showPromptCredits;
    this.showPlanName = showPlanName;
    this.displayStyle = displayStyle;
    this.showUsagePaceTracking = showUsagePaceTracking;
  }

  updateDisplay(snapshot: QuotaSnapshot): void {
    // Check if we need to wait for the minimum animation duration
    if (this.isQuickRefreshing && this.refreshStartTime > 0) {
      const elapsed = Date.now() - this.refreshStartTime;
      if (elapsed < this.minRefreshDuration) {
        const remaining = this.minRefreshDuration - elapsed;
        setTimeout(() => {
          this.updateDisplay(snapshot);
        }, remaining);
        return;
      }
    }

    // 保存最后的快照

    // 清除刷新状态
    this.isQuickRefreshing = false;
    this.refreshStartTime = 0;
    // 设置为快速刷新命令,允许用户点击立即刷新
    this.statusBarItem.command = 'antigravity-quota-watcher.quickRefreshQuota';

    const parts: string[] = [];

    // Display Plan Name if available and enabled
    if (this.showPlanName && snapshot.planName) {
      const planNameFormatted = this.formatPlanName(snapshot.planName);
      parts.push(`Plan: ${planNameFormatted}`);
    }

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
      const usagePaceStr = this.showUsagePaceTracking ? ` ${this.formatUsagePaceGap(model.usagePaceGap, model.paceStatus)}` : '';

      if (model.isExhausted) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: 0%${usagePaceStr}`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(0)}${usagePaceStr}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(0)}${usagePaceStr}`);
        }
      } else if (model.remainingPercentage !== undefined) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: ${model.remainingPercentage.toFixed(0)}%${usagePaceStr}`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(model.remainingPercentage)}${usagePaceStr}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(model.remainingPercentage)}${usagePaceStr}`);
        }
      }
    }

    if (parts.length === 0) {
      this.statusBarItem.text = this.localizationService.t('status.error');
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = this.localizationService.t('tooltip.error');
    } else {
      // Use space as separator
      const displayText = parts.join('  ');
      this.statusBarItem.text = displayText;

      // No background color change - use emoji in formatUsagePaceGap instead
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

  setShowPlanName(value: boolean): void {
    this.showPlanName = value;
  }

  setDisplayStyle(value: 'percentage' | 'progressBar' | 'dots'): void {
    this.displayStyle = value;
  }

  setShowUsagePaceTracking(value: boolean): void {
    this.showUsagePaceTracking = value;
  }

  /**
   * Format usage pace for tooltip display
   * Shows: status text (with emoji) + bold percentage
   */
  private formatUsagePaceForTooltip(gap?: number, paceStatus?: PaceStatus): string {
    if (gap === undefined) return '';

    const sign = gap >= 0 ? '-' : '+';
    const percentage = `${sign}${Math.abs(gap).toFixed(0)}%`;

    // Get localized status text based on pace status
    let statusText = '';
    switch (paceStatus) {
      case 'critical':
        statusText = this.localizationService.t('usagePace.critical');
        break;
      case 'behind':
        statusText = this.localizationService.t('usagePace.behind');
        break;
      case 'ahead':
        statusText = this.localizationService.t('usagePace.ahead');
        break;
      default:
        statusText = this.localizationService.t('usagePace.onTrack');
    }

    return `${statusText} **${percentage}**`;
  }

  /**
   * Format usage pace for status bar display
   * Shows: arrow emoji + percentage
   */
  private formatUsagePaceGap(gap?: number, paceStatus?: PaceStatus): string {
    if (gap === undefined) return '';

    const sign = gap >= 0 ? '-' : '+';
    const emoji = paceStatus === 'critical' ? '⏬' :
      paceStatus === 'behind' ? '⬇️' :
        paceStatus === 'ahead' ? '⬆️' : '➡️';

    return `${emoji}${sign}${Math.abs(gap).toFixed(0)}%`;
  }

  private updateTooltip(snapshot: QuotaSnapshot): void {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`${this.localizationService.t('tooltip.title')}\n\n`);

    if (this.showPromptCredits && snapshot.promptCredits) {
      md.appendMarkdown(`${this.localizationService.t('tooltip.credits')}\n`);
      // Use a list for better alignment
      md.appendMarkdown(`- ${this.localizationService.t('tooltip.available')}: \`${snapshot.promptCredits.available} / ${snapshot.promptCredits.monthly}\`\n`);
      md.appendMarkdown(`- ${this.localizationService.t('tooltip.remaining')}: **${snapshot.promptCredits.remainingPercentage.toFixed(1)}%**\n\n`);
    }

    // 按模型名称字母顺序排序，使同类模型连续显示
    const sortedModels = [...snapshot.models].sort((a, b) => a.label.localeCompare(b.label));

    if (sortedModels.length > 0) {
      // Build table header dynamically based on showUsagePaceTracking
      if (this.showUsagePaceTracking) {
        md.appendMarkdown(`| ${this.localizationService.t('tooltip.model')} | ${this.localizationService.t('tooltip.status')} | ${this.localizationService.t('tooltip.usagePace')} | ${this.localizationService.t('tooltip.resetTime')} |\n`);
        md.appendMarkdown(`| :--- | :--- | :--- | :--- |\n`);
      } else {
        md.appendMarkdown(`| ${this.localizationService.t('tooltip.model')} | ${this.localizationService.t('tooltip.status')} | ${this.localizationService.t('tooltip.resetTime')} |\n`);
        md.appendMarkdown(`| :--- | :--- | :--- |\n`);
      }

      for (const model of sortedModels) {
        const emoji = this.getModelEmoji(model.label);
        const name = model.label; // Full name in tooltip

        let status = '';
        if (model.isExhausted) {
          status = this.localizationService.t('tooltip.depleted');
        } else if (model.remainingPercentage !== undefined) {
          status = `${model.remainingPercentage.toFixed(1)}%`;
        }

        if (this.showUsagePaceTracking) {
          const usagePaceDisplay = this.formatUsagePaceForTooltip(model.usagePaceGap, model.paceStatus);
          md.appendMarkdown(`| ${emoji} ${name} | ${status} | ${usagePaceDisplay} | ${model.timeUntilResetFormatted} |\n`);
        } else {
          md.appendMarkdown(`| ${emoji} ${name} | ${status} | ${model.timeUntilResetFormatted} |\n`);
        }
      }
    }

    this.statusBarItem.tooltip = md;
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
    if (label.includes('Pro (High)') || label.includes('Pro (Low)') || label.includes('Pro')) {
      return 'Gemini';
    }
    if (label.includes('GPT')) {
      return 'GPT';
    }

    return label.split(' ')[0];
  }

  private getProgressBar(percentage: number): string {
    // 确保百分比在 0-100 之间
    const p = Math.max(0, Math.min(100, percentage));

    // 8 blocks for finer granularity: ████████ / ██░░░░░░
    const totalBlocks = 8;
    const filledBlocks = Math.round((p / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;

    const filledChar = '█';
    const emptyChar = '░';

    return `${filledChar.repeat(filledBlocks)}${emptyChar.repeat(emptyBlocks)}`;
  }

  private getDotsBar(percentage: number): string {
    // 确保百分比在 0-100 之间
    const p = Math.max(0, Math.min(100, percentage));

    // 5 dots for cleaner look: ●●●○○
    const totalDots = 5;
    const filledDots = Math.round((p / 100) * totalDots);
    const emptyDots = totalDots - filledDots;

    const filledChar = '●';
    const emptyChar = '○';

    return `${filledChar.repeat(filledDots)}${emptyChar.repeat(emptyDots)}`;
  }

  private formatPlanName(rawName: string): string {
    // Display as-is from API response
    return rawName;
  }

  /**
   * 显示快速刷新状态 - 在当前配额显示前添加刷新图标
   */
  showQuickRefreshing(): void {
    if (this.isQuickRefreshing) {
      return; // 已经在刷新状态
    }
    this.isQuickRefreshing = true;
    this.refreshStartTime = Date.now();

    // 在当前文本前添加刷新图标
    const currentText = this.statusBarItem.text;
    if (!currentText.startsWith('$(sync~spin)')) {
      this.statusBarItem.text = `${this.localizationService.t('status.refreshing')}`;
    }
    // Tooltip handling for string | MarkdownString is tricky, for simple refreshing just keep it simple or append if string
    // Simplified for robustness:
    this.statusBarItem.tooltip = this.localizationService.t('status.refreshing');
    this.statusBarItem.show();
  }

  showDetecting(): void {
    this.statusBarItem.text = this.localizationService.t('status.detecting');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('status.detecting');
    this.statusBarItem.show();
  }

  showInitializing(): void {
    this.statusBarItem.text = this.localizationService.t('status.initializing');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('status.initializing');
    this.statusBarItem.show();
  }

  showFetching(): void {
    this.statusBarItem.text = this.localizationService.t('status.fetching');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('status.fetching');
    this.statusBarItem.show();
  }

  showRetrying(currentRetry: number, maxRetries: number): void {
    this.statusBarItem.text = this.localizationService.t('status.retrying', { current: currentRetry, max: maxRetries });
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.tooltip = this.localizationService.t('status.retrying', { current: currentRetry, max: maxRetries });
    this.statusBarItem.show();
  }

  showError(message: string): void {
    this.statusBarItem.text = this.localizationService.t('status.error');
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.tooltip = `${message}\n\n${this.localizationService.t('tooltip.clickToRetry')}`;
    // 修改命令为刷新配额
    this.statusBarItem.command = 'antigravity-quota-watcher.refreshQuota';
    this.statusBarItem.show();
  }

  clearError(): void {
    this.statusBarItem.text = this.localizationService.t('status.fetching');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('status.fetching');
    this.statusBarItem.show();
  }

  showNotLoggedIn(): void {
    this.statusBarItem.text = this.localizationService.t('status.notLoggedIn');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.statusBarItem.tooltip = `${this.localizationService.t('tooltip.notLoggedIn')}\n\n${this.localizationService.t('tooltip.clickToRecheck')}`;
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
