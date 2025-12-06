import { TranslationMap } from './types';

export const zh_cn: TranslationMap = {
    // Status Bar
    'status.initializing': '⏳ 初始化中...',
    'status.detecting': '🔍 正在检测端口...',
    'status.fetching': '$(sync~spin) 获取配额中...',
    'status.retrying': '$(sync~spin) 重试中 ({current}/{max})...',
    'status.error': '$(error) Antigravity 配额: 错误',
    'status.notLoggedIn': '$(account) 未登录',
    'status.refreshing': '$(sync~spin) 刷新中...',

    // Tooltip
    'tooltip.title': '**Antigravity 模型配额**',
    'tooltip.credits': '💳 **提示词点数 (Credits)**',
    'tooltip.available': '可用',
    'tooltip.remaining': '剩余',
    'tooltip.depleted': '⚠️ **已耗尽**',
    'tooltip.resetTime': '重置时间',
    'tooltip.error': '获取配额信息失败。',
    'tooltip.notLoggedIn': '请登录您的 Google 账号以查看模型配额信息。',
    'tooltip.clickToRetry': '点击重试',
    'tooltip.clickToRecheck': '点击重新检测登录状态',

    // Messages
    'msg.portDetectionFailed': 'Antigravity Quota Watcher: 端口检测失败，请确保 Antigravity 正在运行。',
    'msg.portDetectionSuccess': 'Antigravity Quota Watcher: 端口检测成功。',
    'msg.quotaRefreshed': 'Antigravity 配额已刷新。'
};
