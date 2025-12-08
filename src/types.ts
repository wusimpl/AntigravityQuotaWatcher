/**
 * Antigravity Quota Watcher - type definitions
 */

export interface ModelConfig {
  label: string;
  modelOrAlias: {
    model: string;
  };
  quotaInfo?: {
    remainingFraction?: number;
    resetTime: string;
  };
  supportsImages?: boolean;
  isRecommended?: boolean;
  allowedTiers?: string[];
}

export interface UserStatusResponse {
  userStatus: {
    name: string;
    email: string;
    planStatus?: {
      planInfo: {
        teamsTier: string;
        planName: string;
        monthlyPromptCredits: number;
        monthlyFlowCredits: number;
      };
      availablePromptCredits: number;
      availableFlowCredits: number;
    };
    cascadeModelConfigData?: {
      clientModelConfigs: ModelConfig[];
    };
  };
}

export interface PromptCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface ModelQuotaInfo {
  label: string;
  modelId: string;
  remainingFraction?: number;
  remainingPercentage?: number;
  isExhausted: boolean;
  resetTime: Date;
  timeUntilReset: number;
  timeUntilResetFormatted: string;
}

export interface QuotaSnapshot {
  timestamp: Date;
  promptCredits?: PromptCreditsInfo;
  models: ModelQuotaInfo[];
  planName?: string;
}

export enum QuotaLevel {
  Normal = 'normal',
  Warning = 'warning',
  Critical = 'critical',
  Depleted = 'depleted'
}

export type ApiMethodPreference = 'COMMAND_MODEL_CONFIG' | 'GET_USER_STATUS';

export interface Config {
  enabled: boolean;
  pollingInterval: number;
  warningThreshold: number;
  criticalThreshold: number;
  apiMethod: ApiMethodPreference;
  showPromptCredits: boolean;
  showPlanName: boolean;
  displayStyle: 'percentage' | 'progressBar' | 'dots';
  language: 'auto' | 'en' | 'zh-cn';
}
