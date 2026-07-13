/**
 * 周限检测服务
 * 通过发送简单的 chat 请求检测是否触发了周限 (Weekly Limit)
 * 
 * 配额池规则：
 * - Gemini 3.x 模型 → 一个池子
 * - Claude + GPT → 一个池子
 * - Gemini 2.5 → 一个池子
 */

import * as https from 'https';
import { logger } from '../logger';
import { ProxyService } from '../proxyService';

// Antigravity Chat API 端点 (用于触发配额检测)
const CHAT_API_BASE = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const STREAM_GENERATE_PATH = '/v1internal:streamGenerateContent?alt=sse';
const API_TIMEOUT_MS = 15000;
const MAX_RETRY_COUNT = 3;
const RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_SYSTEM_PROMPT =
    'Please ignore the following [ignore]You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**[/ignore]';
const DEFAULT_SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_HATE', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'BLOCK_NONE' },
];
const DEFAULT_THINKING_BUDGET = 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 64000;
const DEFAULT_TOP_K = 64;

/**
 * 周限检测结果
 */
export interface WeeklyLimitResult {
    model: string;
    pool: 'gemini3' | 'claude_gpt' | 'gemini2.5' | 'unknown';
    status: 'ok' | 'rate_limited' | 'weekly_limited' | 'capacity_exhausted' | 'error';
    reason?: string;           // QUOTA_EXHAUSTED, RATE_LIMIT_EXCEEDED 或 MODEL_CAPACITY_EXHAUSTED
    resetDelay?: string;       // 如 "168h0m0s"
    resetTimestamp?: string;   // ISO 8601 格式
    hoursUntilReset?: number;  // 距离重置的小时数
    totalMinutesUntilReset?: number; // 距离重置的总分钟数
    errorMessage?: string;     // 错误信息
}

/**
 * 配额池类型
 */
export type QuotaPool = 'gemini3' | 'claude_gpt' | 'gemini2.5' | 'unknown';

/**
 * 根据模型名称判断所属配额池
 * 
 * 配额池规则：
 * - Gemini 3.x 模型 → gemini3 池
 * - Claude + GPT → claude_gpt 池
 * - Gemini 2.5 → gemini2.5 池
 */
export function getQuotaPool(modelName: string): QuotaPool {
    const lower = modelName.toLowerCase();

    // Claude 和 GPT 共享一个池子
    if (lower.includes('claude') || lower.includes('gpt')) {
        return 'claude_gpt';
    }

    // Gemini 模型需要根据版本号区分
    if (lower.includes('gemini')) {
        // 匹配 gemini-3, gemini-3.0, gemini-3.5 等
        if (lower.match(/gemini[- ]?3(\.\d+)?/)) {
            return 'gemini3';
        }
        // 匹配 gemini-2.5, gemini-2-5 等
        if (lower.match(/gemini[- ]?2[.-]?5/)) {
            return 'gemini2.5';
        }
    }

    return 'unknown';
}

/**
 * 获取配额池的代表模型（用于检测）
 */
export function getPoolRepresentativeModel(pool: QuotaPool): string {
    switch (pool) {
        case 'gemini3':
            return 'gemini-3-flash-agent';
        case 'claude_gpt':
            return 'claude-3-5-sonnet';
        case 'gemini2.5':
            return 'gemini-2.5-flash';
        default:
            return 'gemini-2.5-flash';
    }
}

/**
 * 获取配额池的显示名称
 */
export function getPoolDisplayName(pool: QuotaPool): string {
    switch (pool) {
        case 'gemini3':
            return 'Gemini 3.x';
        case 'claude_gpt':
            return 'Claude / GPT';
        case 'gemini2.5':
            return 'Gemini 2.5';
        default:
            return 'Unknown';
    }
}

interface NormalizedAntigravityRequest {
    model: string;
    request: any;
}

function isThinkingModel(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    return lower.includes('think') || lower.includes('pro');
}

function mapAntigravityModelName(modelName: string): string {
    let model = modelName;
    if (model.includes('-thinking')) {
        model = model.replace('-thinking', '');
    }

    const lower = model.toLowerCase();
    if (lower.includes('opus')) {
        return 'claude-opus-4-5-thinking';
    }
    if (lower.includes('sonnet') || lower.includes('haiku')) {
        return 'claude-sonnet-4-5-thinking';
    }
    if (lower.includes('claude')) {
        return 'claude-sonnet-4-5-thinking';
    }

    return model;
}

function normalizeContents(contents: any): any[] {
    if (!Array.isArray(contents)) {
        return [];
    }

    const cleaned: any[] = [];
    for (const content of contents) {
        if (!content || typeof content !== 'object') {
            continue;
        }

        const parts = Array.isArray(content.parts) ? content.parts : [];
        const validParts: any[] = [];
        for (const part of parts) {
            if (!part || typeof part !== 'object') {
                continue;
            }

            let hasValidValue = false;
            const nextPart: any = { ...part };

            if (Object.prototype.hasOwnProperty.call(nextPart, 'text')) {
                const textValue = nextPart.text;
                if (Array.isArray(textValue)) {
                    nextPart.text = textValue.map((t) => String(t)).join(' ');
                } else if (typeof textValue !== 'string') {
                    nextPart.text = String(textValue ?? '');
                } else {
                    nextPart.text = textValue.trimEnd();
                }

                if (nextPart.text && nextPart.text.trim().length > 0) {
                    hasValidValue = true;
                }
            }

            if (!hasValidValue) {
                for (const [key, value] of Object.entries(nextPart)) {
                    if (key === 'thought') {
                        continue;
                    }
                    if (value !== null && value !== '' && value !== undefined) {
                        hasValidValue = true;
                        break;
                    }
                }
            }

            if (hasValidValue) {
                validParts.push(nextPart);
            }
        }

        if (validParts.length > 0) {
            cleaned.push({ ...content, parts: validParts });
        }
    }

    return cleaned;
}

function normalizeAntigravityRequest(
    modelName: string,
    request: any
): NormalizedAntigravityRequest {
    const result: any = { ...(request || {}) };
    const generationConfig: any = { ...(result.generationConfig || {}) };

    const existingParts = Array.isArray(result.systemInstruction?.parts)
        ? result.systemInstruction.parts
        : [];
    result.systemInstruction = {
        parts: [{ text: DEFAULT_SYSTEM_PROMPT }, ...existingParts]
    };

    const mappedModel = mapAntigravityModelName(modelName);
    result.model = mappedModel;

    const thinkingConfig: any = { ...(generationConfig.thinkingConfig || {}) };
    const hasThinkingBudget =
        Object.prototype.hasOwnProperty.call(thinkingConfig, 'thinkingBudget') &&
        Number(thinkingConfig.thinkingBudget) !== 0;

    if (isThinkingModel(mappedModel) || hasThinkingBudget) {
        if (thinkingConfig.thinkingBudget === undefined) {
            thinkingConfig.thinkingBudget = DEFAULT_THINKING_BUDGET;
        }
        delete thinkingConfig.thinkingLevel;
        thinkingConfig.includeThoughts = true;
        generationConfig.thinkingConfig = thinkingConfig;
    }

    delete generationConfig.presencePenalty;
    delete generationConfig.frequencyPenalty;
    generationConfig.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
    generationConfig.topK = DEFAULT_TOP_K;

    result.generationConfig = generationConfig;
    result.safetySettings = DEFAULT_SAFETY_SETTINGS;
    result.contents = normalizeContents(result.contents);

    const normalizedModel = result.model;
    delete result.model;

    return { model: normalizedModel, request: result };
}

/**
 * 周限检测器
 */
export class WeeklyLimitChecker {
    private static instance: WeeklyLimitChecker;

    private constructor() { }

    public static getInstance(): WeeklyLimitChecker {
        if (!WeeklyLimitChecker.instance) {
            WeeklyLimitChecker.instance = new WeeklyLimitChecker();
        }
        return WeeklyLimitChecker.instance;
    }

    /**
     * 检测指定模型的周限状态
     * @param accessToken OAuth access token
     * @param projectId 项目 ID
     * @param modelName 模型名称
     */
    public async checkModel(
        accessToken: string,
        projectId: string,
        modelName: string
    ): Promise<WeeklyLimitResult> {
        const pool = getQuotaPool(modelName);

        let lastError: any;
        for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
            try {
                const result = await this.sendChatRequest(accessToken, projectId, modelName);

                // 请求成功，说明配额正常（日志已在 sendChatRequest 中打印）
                return {
                    model: modelName,
                    pool,
                    status: 'ok'
                };
            } catch (error: any) {
                lastError = error;

                // 如果是 429 错误（配额相关），不需要重试，直接解析
                if (error.statusCode === 429) {
                    return this.parseErrorResponse(error, modelName, pool);
                }

                // 网络错误，尝试重试
                if (this.isRetryableError(error) && attempt < MAX_RETRY_COUNT) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    logger.warn('WeeklyLimitChecker', `Attempt ${attempt} failed with network error, retrying in ${delay}ms...`);
                    await this.sleep(delay);
                    continue;
                }

                // 非重试错误或已达最大重试次数
                break;
            }
        }

        // 所有重试都失败了
        return this.parseErrorResponse(lastError, modelName, pool);
    }

    /**
     * 判断错误是否可重试（网络相关错误）
     */
    private isRetryableError(error: any): boolean {
        const message = (error?.message || '').toLowerCase();
        return (
            message.includes('socket') ||
            message.includes('econnreset') ||
            message.includes('econnrefused') ||
            message.includes('etimedout') ||
            message.includes('timeout') ||
            message.includes('tls') ||
            message.includes('disconnected') ||
            message.includes('network') ||
            error.code === 'ECONNRESET' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ETIMEDOUT'
        );
    }

    /**
     * 延迟函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 将网络错误转换为用户友好的消息
     */
    private getFriendlyNetworkErrorMessage(error: any): string {
        const message = (error?.message || '').toLowerCase();

        if (message.includes('tls') || message.includes('ssl') || message.includes('secure')) {
            return 'Network connection unstable, please try again';
        }
        if (message.includes('timeout')) {
            return 'Request timed out, please check your network';
        }
        if (message.includes('econnrefused') || message.includes('connection refused')) {
            return 'Unable to connect to server, please try again later';
        }
        if (message.includes('econnreset') || message.includes('socket') || message.includes('disconnected')) {
            return 'Connection interrupted, please try again';
        }
        if (message.includes('network')) {
            return 'Network error, please check your connection';
        }

        // 默认消息
        return 'Network error, please try again';
    }

    /**
     * 发送简单的 chat 请求
     */
    private sendChatRequest(
        accessToken: string,
        projectId: string,
        modelName: string
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const baseRequest = {
                contents: [
                    { role: 'user', parts: [{ text: 'hi' }] }
                ],
                generationConfig: {
                    maxOutputTokens: 10,
                    temperature: 0.1
                }
            };
            const normalized = normalizeAntigravityRequest(modelName, baseRequest);
            const payload = {
                model: normalized.model,
                project: projectId,
                request: normalized.request
            };

            const postData = JSON.stringify(payload);
            const url = new URL(CHAT_API_BASE);
            const requestType = normalized.model.toLowerCase().includes('image') ? 'image_gen' : 'agent';

            // 获取代理 Agent（如果配置了代理）
            const proxyAgent = ProxyService.getInstance().getAgentForHost(url.hostname);

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: 443,
                path: STREAM_GENERATE_PATH,
                method: 'POST',
                timeout: API_TIMEOUT_MS,
                agent: proxyAgent,  // 添加代理 agent 支持
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'antigravity/1.11.3 windows/amd64',
                    'Accept-Encoding': 'gzip',
                    'requestId': `req-${this.generateUUID()}`,
                    'requestType': requestType
                }
            };

            logger.info('WeeklyLimitChecker', 'Checking model', {
                model: modelName,
                normalizedModel: normalized.model,
                requestType
            });

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        // 成功，解析模型回复作为配额正常的证据
                        const replyText = this.extractReplyText(data);
                        const replyPreview = replyText.substring(0, 120);
                        logger.info('WeeklyLimitChecker', 'Quota OK', {
                            model: modelName,
                            normalizedModel: normalized.model,
                            replyPreview
                        });
                        resolve({ success: true, data });
                    } else {
                        const preview = data.substring(0, 200);
                        logger.debug('WeeklyLimitChecker', 'HTTP error response', {
                            status: res.statusCode,
                            bodyPreview: preview,
                            bodyLength: data.length
                        });
                        const error = new Error(`HTTP ${res.statusCode}`);
                        (error as any).statusCode = res.statusCode;
                        (error as any).responseBody = data;
                        reject(error);
                    }
                });
            });

            req.on('error', (e) => {
                logger.error('WeeklyLimitChecker', 'Request error', { message: e.message });
                reject(e);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * 解析错误响应，提取周限信息
     */
    private parseErrorResponse(
        error: any,
        modelName: string,
        pool: QuotaPool
    ): WeeklyLimitResult {
        const statusCode = error.statusCode;
        const responseBody = error.responseBody;

        // 网络错误（无 statusCode）
        if (!statusCode) {
            const friendlyMessage = this.getFriendlyNetworkErrorMessage(error);
            logger.warn('WeeklyLimitChecker', 'Network error', {
                model: modelName,
                message: error.message
            });
            return {
                model: modelName,
                pool,
                status: 'error',
                errorMessage: friendlyMessage
            };
        }

        // 非 429 错误
        if (statusCode !== 429) {
            logger.warn('WeeklyLimitChecker', 'HTTP error', { model: modelName, statusCode });
            return {
                model: modelName,
                pool,
                status: 'error',
                errorMessage: error.message || `HTTP ${statusCode}`
            };
        }

        // 解析 429 错误响应
        try {
            const errorData = JSON.parse(responseBody);
            const details = errorData?.error?.details || [];

            for (const detail of details) {
                if (detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo') {
                    const metadata = detail.metadata || {};
                    const reason = detail.reason || '';
                    const resetDelay = metadata.quotaResetDelay || '';
                    const resetTimestamp = metadata.quotaResetTimeStamp || '';

                    // 计算距离重置的时间
                    let hoursUntilReset: number | undefined;
                    let totalMinutesUntilReset: number | undefined;
                    if (resetDelay) {
                        const parsed = this.parseResetDelay(resetDelay);
                        if (parsed) {
                            hoursUntilReset = parsed.hours;
                            totalMinutesUntilReset = parsed.totalMinutes;
                        }
                    }

                    // 判断错误类型
                    if (reason === 'MODEL_CAPACITY_EXHAUSTED') {
                        logger.info('WeeklyLimitChecker', 'Capacity exhausted', {
                            model: modelName,
                            pool,
                            reason,
                            resetDelay,
                            resetTimestamp
                        });
                        return {
                            model: modelName,
                            pool,
                            status: 'capacity_exhausted',
                            reason,
                            errorMessage: metadata.model || modelName
                        };
                    } else if (reason === 'QUOTA_EXHAUSTED') {
                        const isWeekly = hoursUntilReset !== undefined && hoursUntilReset > 5;

                        if (isWeekly) {
                            logger.info('WeeklyLimitChecker', 'Weekly limit', {
                                model: modelName,
                                pool,
                                hoursUntilReset,
                                resetDelay,
                                resetTimestamp
                            });
                            return {
                                model: modelName,
                                pool,
                                status: 'weekly_limited',
                                reason,
                                resetDelay,
                                resetTimestamp,
                                hoursUntilReset,
                                totalMinutesUntilReset
                            };
                        } else {
                            logger.info('WeeklyLimitChecker', 'Rate limit', {
                                model: modelName,
                                pool,
                                hoursUntilReset,
                                resetDelay,
                                resetTimestamp
                            });
                            return {
                                model: modelName,
                                pool,
                                status: 'rate_limited',
                                reason,
                                resetDelay,
                                resetTimestamp,
                                hoursUntilReset,
                                totalMinutesUntilReset
                            };
                        }
                    } else if (reason === 'RATE_LIMIT_EXCEEDED') {
                        logger.info('WeeklyLimitChecker', 'Rate limit exceeded', {
                            model: modelName,
                            pool,
                            resetDelay,
                            resetTimestamp
                        });
                        return {
                            model: modelName,
                            pool,
                            status: 'rate_limited',
                            reason,
                            resetDelay,
                            resetTimestamp,
                            hoursUntilReset,
                            totalMinutesUntilReset
                        };
                    }
                }
            }

            // 429 但没有找到详细信息
            const rawPreview = (responseBody || '').substring(0, 200);
            logger.warn('WeeklyLimitChecker', '429 without details', {
                model: modelName,
                rawPreview
            });
            const errorMessage = errorData?.error?.message || '';
            return {
                model: modelName,
                pool,
                status: 'rate_limited',
                errorMessage: `Rate limited: ${errorMessage || 'no details'}`
            };

        } catch (parseError) {
            const rawPreview = (responseBody || '').substring(0, 200);
            logger.error('WeeklyLimitChecker', 'Failed to parse 429 response', {
                model: modelName,
                rawPreview
            });
            return {
                model: modelName,
                pool,
                status: 'error',
                errorMessage: `Failed to parse error response: ${responseBody?.substring(0, 200)}`
            };
        }
    }

    /**
     * 解析重置延迟字符串 (如 "168h0m0s", "5h30m0s")
     * 返回小时数和总分钟数
     */
    private parseResetDelay(delay: string): { hours: number; minutes: number; totalMinutes: number } | undefined {
        const hMatch = delay.match(/(\d+)h/);
        const mMatch = delay.match(/(\d+)m/);

        const hours = hMatch ? parseInt(hMatch[1], 10) : 0;
        const minutes = mMatch ? parseInt(mMatch[1], 10) : 0;

        if (!hMatch && !mMatch) {
            return undefined;
        }

        return {
            hours,
            minutes,
            totalMinutes: hours * 60 + minutes
        };
    }

    /**
     * 从 SSE 响应中提取模型回复的文字
     */
    private extractReplyText(sseData: string): string {
        const textParts: string[] = [];
        
        // SSE 格式: data: {...}\ndata: {...}\n
        const lines = sseData.split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            
            try {
                const json = JSON.parse(line.substring(6));
                const parts = json?.response?.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    // 只取非 thought 的文字
                    if (part.text && !part.thought) {
                        textParts.push(part.text);
                    }
                }
            } catch {
                // 忽略解析失败的行
            }
        }
        
        const fullText = textParts.join('').trim();
        // 截取前 100 字符，避免日志太长
        return fullText.length > 100 ? fullText.substring(0, 100) + '...' : fullText;
    }

    /**
     * 生成 UUID
     */
    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
