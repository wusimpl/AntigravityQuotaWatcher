export type TranslationKey =
    // Status Bar
    | 'status.initializing'
    | 'status.detecting'
    | 'status.fetching'
    | 'status.retrying'
    | 'status.error'
    | 'status.notLoggedIn'
    | 'status.refreshing'

    // Tooltip
    | 'tooltip.title'
    | 'tooltip.credits'
    | 'tooltip.available'
    | 'tooltip.remaining'
    | 'tooltip.depleted'
    | 'tooltip.resetTime'
    | 'tooltip.model'
    | 'tooltip.status'
    | 'tooltip.error'
    | 'tooltip.notLoggedIn'
    | 'tooltip.clickToRetry'
    | 'tooltip.clickToRecheck'

    // Messages
    | 'msg.portDetectionFailed'
    | 'msg.portDetectionSuccess'
    | 'msg.quotaRefreshed';

export interface TranslationMap {
    [key: string]: string;
}
