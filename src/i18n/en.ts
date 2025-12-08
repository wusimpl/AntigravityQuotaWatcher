import { TranslationMap } from './types';

export const en: TranslationMap = {
    // Status Bar
    'status.initializing': '⏳ Initializing...',
    'status.detecting': '🔍 Detecting port...',
    'status.fetching': '$(sync~spin) Fetching quota...',
    'status.retrying': '$(sync~spin) Retrying ({current}/{max})...',
    'status.error': '$(error) Antigravity Quota: Error',
    'status.notLoggedIn': '$(account) Not logged in',
    'status.refreshing': '$(sync~spin) Refreshing...',

    // Tooltip
    'tooltip.title': '**Antigravity Model Quota**', // Markdown bold
    'tooltip.credits': '💳 **Prompt Credits**',
    'tooltip.available': 'Available',
    'tooltip.remaining': 'Remaining',
    'tooltip.depleted': '⚠️ **Depleted**',
    'tooltip.resetTime': 'Reset',
    'tooltip.model': 'Model',
    'tooltip.status': 'Status',
    'tooltip.error': 'Error fetching quota information.',
    'tooltip.notLoggedIn': 'Sign in to your Google account to view model quota information.',
    'tooltip.clickToRetry': 'Click to retry',
    'tooltip.clickToRecheck': 'Click to recheck login status',

    // Messages
    'msg.portDetectionFailed': 'Antigravity Quota Watcher: Failed to detect port. Please ensure Antigravity is running.',
    'msg.portDetectionSuccess': 'Antigravity Quota Watcher: Port detected successfully.',
    'msg.quotaRefreshed': 'Antigravity quota refreshed.'
};
