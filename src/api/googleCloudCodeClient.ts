/**
 * Google Cloud Code API 客户端
 * 封装与 Google Cloud Code API 的交互
 */

import * as https from 'https';
import {
    CLOUD_CODE_API_BASE,
    LOAD_CODE_ASSIST_PATH,
    FETCH_AVAILABLE_MODELS_PATH,
    API_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_DELAY_MS,
} from '../auth/constants';
import { logger } from '../logger';
import { ProxyService } from '../proxyService';

/**
 * 项目信息 (loadCodeAssist 响应)
 */
export interface ProjectInfo {
    projectId: string;
    tier: string;  // 'FREE', 'PRO', 'TEAMS' 等
}

/**
 * 模型配额信息 (单个模型)
 */
export interface ModelQuotaFromApi {
    modelName: string;
    displayName: string;
    remainingQuota: number;  // 0-1 之间的小数
    resetTime: string;       // ISO 8601 格式
    isExhausted: boolean;
}

/**
 * 模型配额列表 (fetchAvailableModels 响应)
 */
export interface ModelsQuotaResponse {
    models: ModelQuotaFromApi[];
}

/**
 * API 错误类
 */
export class GoogleApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public errorCode?: string
    ) {
        super(message);
        this.name = 'GoogleApiError';
    }

    /**
     * 是否可以重试
     */
    public isRetryable(): boolean {
        // 5xx 错误和 429 (Rate Limit) 可以重试
        return this.statusCode >= 500 || this.statusCode === 429;
    }

    /**
     * 是否需要重新登录
     */
    public needsReauth(): boolean {
        return this.statusCode === 401;
    }
}

/**
 * Google Cloud Code API 客户端
 */
export class GoogleCloudCodeClient {
    private static instance: GoogleCloudCodeClient;

    private constructor() { }

    /**
     * 获取单例实例
     */
    public static getInstance(): GoogleCloudCodeClient {
        if (!GoogleCloudCodeClient.instance) {
            GoogleCloudCodeClient.instance = new GoogleCloudCodeClient();
        }
        return GoogleCloudCodeClient.instance;
    }

    /**
     * 获取项目信息和订阅等级
     * @param accessToken OAuth access token
     * @returns ProjectInfo
     */
    public async loadProjectInfo(accessToken: string): Promise<ProjectInfo> {
        const requestBody = { metadata: { ideType: 'ANTIGRAVITY' } };
        logger.debug('GoogleAPI', 'loadProjectInfo: Sending request', requestBody);

        const response = await this.makeApiRequest(
            LOAD_CODE_ASSIST_PATH,
            accessToken,
            requestBody
        );

        // console.log('[GoogleAPI] loadProjectInfo: Raw response:', JSON.stringify(response));

        // 解析响应
        // 响应格式: { cloudaicompanionProject, currentTier, paidTier }
        // 优先使用 paidTier，如果为空则使用 currentTier
        const paidTier = response.paidTier || {};
        const currentTier = response.currentTier || {};
        const tier = paidTier.id || currentTier.id || 'FREE';

        const result = {
            projectId: response.cloudaicompanionProject || '',
            tier: tier,
        };
        logger.debug('GoogleAPI', 'loadProjectInfo: Parsed result', result);

        return result;
    }

    /**
     * 获取模型配额列表
     * @param accessToken OAuth access token
     * @param projectId 项目 ID (必需，从 loadProjectInfo 获取)
     * @returns ModelsQuotaResponse
     */
    public async fetchModelsQuota(
        accessToken: string,
        projectId: string
    ): Promise<ModelsQuotaResponse> {
        // projectId 可能为空 仅记录警告，继续尝试 API 调用
        if (!projectId) {
            logger.warn('GoogleAPI', 'fetchModelsQuota: projectId is empty, attempting API call without project');
        }

        // 如果 projectId 为空，不传 project 字段
        const body: any = projectId ? { project: projectId } : {};
        logger.debug('GoogleAPI', 'fetchModelsQuota: Request body', body);

        const response = await this.makeApiRequest(
            FETCH_AVAILABLE_MODELS_PATH,
            accessToken,
            body
        );

        // console.log('[GoogleAPI] fetchModelsQuota: Raw response:', JSON.stringify(response));

        // 解析响应
        // 响应格式: { models: { "model-name": { quotaInfo: {...} }, ... } }
        // 注意: models 是一个对象映射，不是数组！
        const modelsMap = response.models || {};
        const modelNames = Object.keys(modelsMap);
        logger.debug('GoogleAPI', `fetchModelsQuota: Found models (${modelNames.length})`, modelNames);

        const models: ModelQuotaFromApi[] = [];
        const filteredByName: string[] = [];
        const filteredByVersion: string[] = [];

        // 过滤条件：只保留包含 gemini、claude 或 gpt 的模型
        const allowedModelPatterns = /gemini|claude|gpt/i;

        for (const [modelName, modelInfo] of Object.entries(modelsMap)) {
            // 过滤模型名称
            if (!allowedModelPatterns.test(modelName)) {
                filteredByName.push(modelName);
                continue;
            }

            // 过滤旧版本 Gemini 模型 (< 3.0)
            if (!this.isModelVersionSupported(modelName)) {
                filteredByVersion.push(modelName);
                continue;
            }

            const info = modelInfo as any;
            if (info.quotaInfo) {
                // [DEBUG] 打印关键的模型配额信息
                logger.info('GoogleAPI', `[QUOTA_DEBUG] Model "${modelName}": remaining=${info.quotaInfo.remainingFraction}, resetTime=${info.quotaInfo.resetTime}, maxTokens=${info.maxTokens || 'N/A'}`);
                
                // 如果是 gemini-3.8-flash-tiered 或通用 gemini-3.8-flash，拆分为 High / Medium / Low 三档
                if (modelName === 'gemini-3.8-flash-tiered' || modelName === 'gemini-3.8-flash') {
                    const tiers = [
                        { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
                        { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
                        { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
                    ];
                    const baseParsed = this.parseModelQuota(modelName, info);
                    for (const tier of tiers) {
                        models.push({
                            ...baseParsed,
                            modelName: tier.id,
                            displayName: tier.name
                        });
                        logger.debug('GoogleAPI', `fetchModelsQuota: Model "${tier.id}" (${tier.name}) -> remaining: ${baseParsed.remainingQuota * 100}%`);
                    }
                } else {
                    const parsed = this.parseModelQuota(modelName, info);
                    logger.debug('GoogleAPI', `fetchModelsQuota: Model "${modelName}" -> remaining: ${parsed.remainingQuota * 100}%`);
                    models.push(parsed);
                }
            } else {
                logger.debug('GoogleAPI', `fetchModelsQuota: Model "${modelName}" has no quotaInfo, skipping`);
            }
        }

        if (filteredByName.length > 0 || filteredByVersion.length > 0) {
            logger.debug('GoogleAPI', 'fetchModelsQuota: Filtered out models', {
                byName: filteredByName,
                byVersion: filteredByVersion,
            });
        }

        logger.debug('GoogleAPI', 'fetchModelsQuota: Total models with quota', { count: models.length });
        return { models };
    }

    /**
     * 解析单个模型的配额信息
     * @param modelName 模型名称（从对象的 key 获取）
     * @param modelInfo 模型信息对象
     */
    private parseModelQuota(modelName: string, modelInfo: any): ModelQuotaFromApi {
        const quotaInfo = modelInfo.quotaInfo || {};
        // 如果没有 remainingFraction 字段，说明配额已用完，应该返回 0
        const remainingFraction = quotaInfo.remainingFraction ?? 0;

        // 生成友好的显示名称
        const displayName = this.formatModelDisplayName(modelName);

        return {
            modelName: modelName,
            displayName: displayName,
            remainingQuota: typeof remainingFraction === 'number' ? remainingFraction : 0,
            resetTime: quotaInfo.resetTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            isExhausted: remainingFraction <= 0,
        };
    }

    /**
     * 格式化模型显示名称
     * 例如: "gemini-2.5-pro" -> "Gemini 2.5 Pro"
     */
    private formatModelDisplayName(modelName: string): string {
        const lower = modelName.toLowerCase();
        if (lower === 'gemini-3.8-flash-high') {
            return 'Gemini 3.8 Flash (High)';
        }
        if (lower === 'gemini-3.8-flash-medium') {
            return 'Gemini 3.8 Flash (Medium)';
        }
        if (lower === 'gemini-3.8-flash-low') {
            return 'Gemini 3.8 Flash (Low)';
        }
        if (lower === 'claude-sonnet-4-6') {
            return 'Claude Sonnet 4.6 (Thinking)';
        }
        if (lower === 'claude-opus-4-6-thinking') {
            return 'Claude Opus 4.6 (Thinking)';
        }
        if (lower === 'gpt-oss-120b-medium') {
            return 'GPT-OSS 120B (Medium)';
        }

        // 先尝试修复版本号格式，将 "3-5" 这种格式转换为 "3.5"
        // 匹配模式：数字-数字 (例如 claude-3-5-sonnet -> claude-3.5-sonnet)
        const fixedModelName = modelName.replace(/(\d+)-(\d+)/g, '$1.$2');

        return fixedModelName
            .split('-')
            .map(part => {
                // 数字部分保持原样
                if (/^\d/.test(part)) {
                    return part;
                }
                const lowerPart = part.toLowerCase();
                if (lowerPart === 'gpt') {
                    return 'GPT';
                }
                if (lowerPart === 'oss') {
                    return 'OSS';
                }
                // 首字母大写
                return part.charAt(0).toUpperCase() + part.slice(1);
            })
            .join(' ');
    }

    /**
     * 发送 API 请求 (带重试)
     */
    private async makeApiRequest(
        path: string,
        accessToken: string,
        body: object
    ): Promise<any> {
        let lastError: Error | null = null;
        logger.debug('GoogleAPI', `makeApiRequest: ${path} (max retries: ${MAX_RETRIES})`);

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                logger.debug('GoogleAPI', `makeApiRequest: Attempt ${attempt + 1}/${MAX_RETRIES}`);
                return await this.doRequest(path, accessToken, body);
            } catch (e) {
                lastError = e as Error;
                logger.error('GoogleAPI', `makeApiRequest: Attempt ${attempt + 1} failed`, { message: lastError.message });

                if (e instanceof GoogleApiError) {
                    logger.debug('GoogleAPI', 'makeApiRequest: GoogleApiError', {
                        status: e.statusCode,
                        retryable: e.isRetryable(),
                        needsReauth: e.needsReauth(),
                    });
                    // 不可重试的错误直接抛出
                    if (!e.isRetryable()) {
                        logger.debug('GoogleAPI', 'makeApiRequest: Error is not retryable, throwing');
                        throw e;
                    }
                    // 需要重新登录的错误直接抛出
                    if (e.needsReauth()) {
                        logger.debug('GoogleAPI', 'makeApiRequest: Needs re-auth, throwing');
                        throw e;
                    }
                }

                // 等待后重试
                if (attempt < MAX_RETRIES - 1) {
                    const delay = RETRY_DELAY_MS * (attempt + 1);
                    logger.debug('GoogleAPI', `makeApiRequest: Waiting ${delay}ms before retry...`);
                    await this.delay(delay);
                }
            }
        }

        logger.error('GoogleAPI', 'makeApiRequest: All retries exhausted');
        throw lastError || new Error('Request failed after retries');
    }

    /**
     * 执行单次 API 请求
     */
    private doRequest(
        path: string,
        accessToken: string,
        body: object
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(CLOUD_CODE_API_BASE);
            const postData = JSON.stringify(body);

            logger.debug('GoogleAPI', `doRequest: POST ${url.hostname}${path}`);
            logger.debug('GoogleAPI', `doRequest: Body length: ${postData.length} bytes`);
            logger.debug('GoogleAPI', `doRequest: Token: ${this.maskToken(accessToken)}`);

            // 获取代理 Agent（如果配置了代理）
            const proxyAgent = ProxyService.getInstance().getAgentForHost(url.hostname);
            if (proxyAgent) {
                logger.debug('GoogleAPI', 'doRequest: Using proxy agent');
            }

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: 443,
                path: path,
                method: 'POST',
                timeout: API_TIMEOUT_MS,
                agent: proxyAgent,  // 添加代理 agent 支持
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'AntigravityQuotaWatcher/1.0',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                logger.debug('GoogleAPI', `doRequest: Response status: ${res.statusCode}`);

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    logger.debug('GoogleAPI', `doRequest: Response body length: ${data.length} bytes`);

                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const response = JSON.parse(data);
                            logger.debug('GoogleAPI', 'doRequest: Success');
                            resolve(response);
                        } catch (e) {
                            logger.error('GoogleAPI', 'doRequest: Failed to parse JSON response');
                            reject(new Error(`Failed to parse API response: ${data}`));
                        }
                    } else {
                        // 解析错误响应
                        let errorMessage = `API request failed with status ${res.statusCode}`;
                        let errorCode: string | undefined;

                        try {
                            const errorResponse = JSON.parse(data);
                            errorMessage = errorResponse.error?.message || errorResponse.message || errorMessage;
                            errorCode = errorResponse.error?.code || errorResponse.code;
                            logger.error('GoogleAPI', `doRequest: Error response:`, JSON.stringify(errorResponse));
                        } catch {
                            logger.error('GoogleAPI', `doRequest: Raw error response: ${data}`);
                        }

                        reject(new GoogleApiError(
                            errorMessage,
                            res.statusCode || 500,
                            errorCode
                        ));
                    }
                });
            });

            req.on('error', (e) => {
                logger.error('GoogleAPI', `doRequest: Network error: ${e.message}`);
                reject(new Error(`Network error: ${e.message}`));
            });

            req.on('timeout', () => {
                logger.error('GoogleAPI', `doRequest: Request timeout after ${API_TIMEOUT_MS}ms`);
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 遮蔽 token，只显示前6位和后4位
     */
    private maskToken(token: string): string {
        if (token.length <= 14) {
            return '***';
        }
        return `${token.substring(0, 6)}***${token.substring(token.length - 4)}`;
    }

    /**
     * 检查模型版本是否支持 (过滤掉 3.8 以下以及遗留/内部实验通道的 Gemini)
     */
    private isModelVersionSupported(modelName: string): boolean {
        const lowerName = modelName.toLowerCase();

        // 如果不是 Gemini 模型，直接支持 (如 Claude, GPT)
        if (!lowerName.includes('gemini')) {
            return true;
        }

        // 过滤掉内部/遗留实验通道 (如 image, agent, lite, extra-low 等)
        if (
            lowerName.includes('image') ||
            lowerName.includes('agent') ||
            lowerName.includes('lite') ||
            lowerName.includes('extra-low')
        ) {
            return false;
        }

        // 提取版本号 (例如 gemini-3.8-flash -> 3.8, gemini-3.5-flash -> 3.5)
        const versionMatch = lowerName.match(/gemini-(\d+(?:\.\d+)?)/);

        if (versionMatch && versionMatch[1]) {
            const version = parseFloat(versionMatch[1]);
            // 只允许 Antigravity 2.5.5+ 实际使用的 Gemini 版本 (>= 3.8)
            return version >= 3.8;
        }

        return false;
    }
}
