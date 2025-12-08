import { TranslationMap } from './types';

export const zh_cn: TranslationMap = {
    // 状态栏
    'status.initializing': '⏳ 初始化中...',
    'status.detecting': '🔍 检测端口中...',
    'status.fetching': '$(sync~spin) 获取配额中...',
    'status.retrying': '$(sync~spin) 重试中 ({current}/{max})...',
    'status.error': '$(error) Antigravity 配额: 错误',
    'status.notLoggedIn': '$(account) 未登录',
    'status.refreshing': '$(sync~spin) 刷新中...',

    // 提示框
    'tooltip.title': '**Antigravity 模型配额**',
    'tooltip.credits': '💳 **提示词额度**',
    'tooltip.available': '可用',
    'tooltip.remaining': '剩余',
    'tooltip.depleted': '⚠️ **已耗尽**',
    'tooltip.resetTime': '重置时间',
    'tooltip.model': '模型',
    'tooltip.status': '剩余',
    'tooltip.error': '获取配额信息时出错。',
    'tooltip.notLoggedIn': '请登录您的 Google 账户以查看模型配额信息。',
    'tooltip.clickToRetry': '点击重试',
    'tooltip.clickToRecheck': '点击重新检查登录状态',

    // 消息
    'msg.portDetectionFailed': 'Antigravity Quota Watcher: 端口检测失败。请确保 Antigravity 正在运行。',
    'msg.portDetectionSuccess': 'Antigravity Quota Watcher: 端口检测成功。',
    'msg.quotaRefreshed': 'Antigravity 配额已刷新。'
};
