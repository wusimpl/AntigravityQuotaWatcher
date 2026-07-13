/**
 * Status bar service
 */

import * as vscode from 'vscode';
import { ModelQuotaInfo, QuotaSnapshot } from './types';
import { LocalizationService } from './i18n/localizationService';
import { selectLatestGeminiFlash, selectLatestGeminiProLow } from './geminiModelSelection';

export class StatusBarService {
  private statusBarItem: vscode.StatusBarItem;
  private warningThreshold: number;
  private criticalThreshold: number;
  private showPromptCredits: boolean;
  private showPlanName: boolean;
  private showGeminiPro: boolean;
  private showGeminiFlash: boolean;
  private displayStyle: 'percentage' | 'progressBar' | 'dots';
  private localizationService: LocalizationService;
  /** 标记当前 tooltip 是否已添加过时警告，避免重复 prepend */
  private hasStaleWarning: boolean = false;

  private isQuickRefreshing: boolean = false;
  private refreshStartTime: number = 0;
  private readonly minRefreshDuration: number = 1000;

  /** 缓存最后一次的配额快照 */
  private lastSnapshot: QuotaSnapshot | undefined;

  constructor(
    warningThreshold: number = 50,
    criticalThreshold: number = 30,
    showPromptCredits: boolean = false,
    showPlanName: boolean = false,
    showGeminiPro: boolean = true,
    showGeminiFlash: boolean = true,
    displayStyle: 'percentage' | 'progressBar' | 'dots' = 'progressBar'
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
    this.showGeminiPro = showGeminiPro;
    this.showGeminiFlash = showGeminiFlash;
    this.displayStyle = displayStyle;
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
    this.lastSnapshot = snapshot;

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

      if (model.isExhausted) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: 0%`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(0)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(0)}`);
        }
      } else if (model.remainingPercentage !== undefined) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: ${model.remainingPercentage.toFixed(0)}%`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(model.remainingPercentage)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(model.remainingPercentage)}`);
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

  setShowPlanName(value: boolean): void {
    this.showPlanName = value;
  }

  setShowGeminiPro(value: boolean): void {
    this.showGeminiPro = value;
  }

  setShowGeminiFlash(value: boolean): void {
    this.showGeminiFlash = value;
  }

  setDisplayStyle(value: 'percentage' | 'progressBar' | 'dots'): void {
    this.displayStyle = value;
  }

  /** 获取缓存的最后一次配额快照 */
  getLastSnapshot(): QuotaSnapshot | undefined {
    return this.lastSnapshot;
  }

  private updateTooltip(snapshot: QuotaSnapshot): void {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;
    // 新构建 tooltip 时，重置过时提示标记
    this.hasStaleWarning = false;

    const titleSuffix = snapshot.planName ? ` (${snapshot.planName})` : '';
    md.appendMarkdown(`${this.localizationService.t('tooltip.title')}${titleSuffix}\n\n`);

    // 显示 Google 账号邮箱 (仅 GOOGLE_API 方法)
    if (snapshot.userEmail) {
      md.appendMarkdown(`📧 ${snapshot.userEmail}\n\n`);
    }

    if (this.showPromptCredits && snapshot.promptCredits) {
      md.appendMarkdown(`${this.localizationService.t('tooltip.credits')}\n`);
      // Use a list for better alignment
      md.appendMarkdown(`- ${this.localizationService.t('tooltip.available')}: \`${snapshot.promptCredits.available} / ${snapshot.promptCredits.monthly}\`\n`);
      md.appendMarkdown(`- ${this.localizationService.t('tooltip.remaining')}: **${snapshot.promptCredits.remainingPercentage.toFixed(1)}%**\n\n`);
    }

    // 按模型名称字母顺序排序，使同类模型连续显示
    const sortedModels = [...snapshot.models].sort((a, b) => a.label.localeCompare(b.label));

    if (sortedModels.length > 0) {
      md.appendMarkdown(`| ${this.localizationService.t('tooltip.model')} | ${this.localizationService.t('tooltip.status')} | ${this.localizationService.t('tooltip.resetTime')} |\n`);
      md.appendMarkdown(`| :--- | :--- | :--- |\n`);

      for (const model of sortedModels) {
        const emoji = this.getModelEmoji(model.label);
        const name = model.label; // Full name in tooltip

        let status = '';
        if (model.isExhausted) {
          status = this.localizationService.t('tooltip.depleted');
        } else if (model.remainingPercentage !== undefined) {
          status = `${model.remainingPercentage.toFixed(1)}%`;
        }

        md.appendMarkdown(`| ${emoji} ${name} | ${status} | ${model.timeUntilResetFormatted} |\n`);
      }
    }

    this.statusBarItem.tooltip = md;
  }

  private selectModelsToDisplay(models: ModelQuotaInfo[]): ModelQuotaInfo[] {
    const result: ModelQuotaInfo[] = [];

    // 1. Claude - 优先选非 Thinking 版本，若无则回退到 Thinking 版本
    const claude = models.find(model => this.isClaudeWithoutThinking(model.label))
      || models.find(model => model.label.toLowerCase().includes('claude'));
    if (claude) {
      result.push(claude);
    }

    // 2. Gemini Pro (Low) - 根据配置决定是否显示
    if (this.showGeminiPro) {
      const proLow = selectLatestGeminiProLow(models);
      if (proLow && !result.includes(proLow)) {
        result.push(proLow);
      }
    }

    // 3. Gemini Flash - 根据配置决定是否显示
    if (this.showGeminiFlash) {
      const flash = selectLatestGeminiFlash(models);
      if (flash && !result.includes(flash)) {
        result.push(flash);
      }
    }

    return result;
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
    // Gemini Flash 显示为 G Flash
    if (label.includes('Gemini') && label.includes('Flash')) {
      return 'G Flash';
    }
    // Gemini Pro 显示为 G Pro
    if (label.includes('Pro (High)') || label.includes('Pro (Low)') || label.includes('Pro')) {
      return 'G Pro';
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

  /**
   * 显示未登录状态 (GOOGLE_API 方式)
   */
  showNotLoggedIn(): void {
    this.statusBarItem.text = this.localizationService.t('status.notLoggedIn');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('tooltip.clickToLogin');
    this.statusBarItem.command = 'antigravity-quota-watcher.googleLogin';
    this.statusBarItem.show();
  }

  /**
   * 显示登录中状态 (GOOGLE_API 方式)
   */
  showLoggingIn(): void {
    this.statusBarItem.text = this.localizationService.t('status.loggingIn');
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = this.localizationService.t('status.loggingIn');
    this.statusBarItem.command = undefined;
    this.statusBarItem.show();
  }

  /**
   * 显示登录过期状态 (GOOGLE_API 方式)
   */
  showLoginExpired(): void {
    this.statusBarItem.text = this.localizationService.t('status.loginExpired');
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.tooltip = this.localizationService.t('tooltip.clickToRelogin');
    this.statusBarItem.command = 'antigravity-quota-watcher.googleLogin';
    this.statusBarItem.show();
  }

  /**
   * 显示数据过时标志 (网络问题或超时)
   * 先恢复到上次的配额显示，再在前面添加过时图标
   */
  showStale(): void {
    // 如果正在刷新中，先恢复到上次的配额显示
    if (this.isQuickRefreshing && this.lastSnapshot) {
      // 清除刷新状态
      this.isQuickRefreshing = false;
      this.refreshStartTime = 0;
      // 恢复配额显示（不触发 updateDisplay 以避免递归）
      this.rebuildDisplayFromSnapshot(this.lastSnapshot);
    }

    // 若从未成功获取过配额，直接显示错误态，避免卡在“获取中”
    if (!this.lastSnapshot) {
      this.showError(this.localizationService.t('tooltip.error'));
      return;
    }

    const currentText = this.statusBarItem.text;
    const staleIcon = this.localizationService.t('status.stale');
    // 避免重复添加
    if (!currentText.startsWith(staleIcon)) {
      this.statusBarItem.text = `${staleIcon} ${currentText}`;
    }
    // 更新 tooltip 添加过时警告
    const currentTooltip = this.statusBarItem.tooltip;
    if (currentTooltip instanceof vscode.MarkdownString) {
      if (this.hasStaleWarning) {
        this.statusBarItem.show();
        return; // 已添加过时警告，不再重复
      }
      const staleWarning = this.localizationService.t('tooltip.staleWarning');
      // 在开头添加警告
      const newMd = new vscode.MarkdownString();
      newMd.isTrusted = true;
      newMd.supportHtml = true;
      newMd.appendMarkdown(`${staleWarning}\n\n`);
      newMd.appendMarkdown(currentTooltip.value);
      this.statusBarItem.tooltip = newMd;
      this.hasStaleWarning = true;
    }
    this.statusBarItem.show();
  }

  /**
   * 从快照重建状态栏显示（内部方法，不更新 lastSnapshot）
   */
  private rebuildDisplayFromSnapshot(snapshot: QuotaSnapshot): void {
    this.statusBarItem.command = 'antigravity-quota-watcher.quickRefreshQuota';

    const parts: string[] = [];

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

      if (model.isExhausted) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: 0%`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(0)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(0)}`);
        }
      } else if (model.remainingPercentage !== undefined) {
        if (this.displayStyle === 'percentage') {
          parts.push(`${indicator} ${emoji} ${shortName}: ${model.remainingPercentage.toFixed(0)}%`);
        } else if (this.displayStyle === 'dots') {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getDotsBar(model.remainingPercentage)}`);
        } else {
          parts.push(`${indicator} ${emoji} ${shortName} ${this.getProgressBar(model.remainingPercentage)}`);
        }
      }
    }

    if (parts.length === 0) {
      this.statusBarItem.text = this.localizationService.t('status.error');
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = this.localizationService.t('tooltip.error');
    } else {
      const displayText = parts.join('  ');
      this.statusBarItem.text = displayText;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.color = undefined;
      this.updateTooltip(snapshot);
    }
  }

  /**
   * 清除过时标志
   */
  clearStale(): void {
    const currentText = this.statusBarItem.text;
    const staleIcon = this.localizationService.t('status.stale');
    // 检查是否以 staleIcon 开头，并安全地移除它
    if (currentText.startsWith(staleIcon)) {
      // 移除 staleIcon，同时处理可能存在的空格分隔符
      let newText = currentText.substring(staleIcon.length);
      // 如果移除后开头是空格，也一并移除
      if (newText.startsWith(' ')) {
        newText = newText.substring(1);
      }
      this.statusBarItem.text = newText;
    }
    // 清除过时标记，允许后续重新添加
    this.hasStaleWarning = false;
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
