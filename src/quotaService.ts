import * as https from "https";
import * as http from "http";
import { UserStatusResponse, QuotaSnapshot, PromptCreditsInfo, ModelQuotaInfo } from "./types";
import { versionInfo } from "./versionInfo";
import { GoogleAuthService, AuthState } from "./auth";
import { GoogleCloudCodeClient, GoogleApiError } from "./api";
import { logger } from "./logger";

// API 方法枚举
export enum QuotaApiMethod {
  //   COMMAND_MODEL_CONFIG = 'COMMAND_MODEL_CONFIG',
  GET_USER_STATUS = 'GET_USER_STATUS',
  GOOGLE_API = 'GOOGLE_API'
}

// 通用请求配置
interface RequestConfig {
  path: string;
  body: object;
  timeout?: number;
}

// 通用请求方法
async function makeRequest(
  config: RequestConfig,
  port: number,
  httpPort: number | undefined,
  csrfToken: string | undefined
): Promise<any> {
  const requestBody = JSON.stringify(config.body);

  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody),
    'Connect-Protocol-Version': '1'
  };

  if (csrfToken) {
    headers['X-Codeium-Csrf-Token'] = csrfToken;
  } else {
    throw new Error('Missing CSRF token');
  }

  const doRequest = (useHttps: boolean, targetPort: number) => new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: '127.0.0.1',
      port: targetPort,
      path: config.path,
      method: 'POST',
      headers,
      rejectUnauthorized: false,
      timeout: config.timeout ?? 5000
    };

    logger.debug('QuotaService', 'Request URL', {
      url: `${useHttps ? 'https' : 'http'}://127.0.0.1:${targetPort}${config.path}`
    });

    const client = useHttps ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let errorDetail = '';
          try {
            const errorBody = JSON.parse(data);
            errorDetail = errorBody.message || errorBody.error || JSON.stringify(errorBody);
          } catch {
            errorDetail = data || '(empty response)';
          }
          reject(new Error(`HTTP error: ${res.statusCode}, detail: ${errorDetail}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error}`));
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(requestBody);
    req.end();
  });

  // 先尝试 HTTPS，失败后回退到 HTTP
  try {
    return await doRequest(true, port);
  } catch (error: any) {
    const msg = (error?.message || '').toLowerCase();
    const shouldRetryHttp = httpPort !== undefined && (error.code === 'EPROTO' || msg.includes('wrong_version_number'));
    if (shouldRetryHttp) {
      logger.warn('QuotaService', 'HTTPS failed; trying HTTP fallback port', { httpPort });
      return await doRequest(false, httpPort);
    }
    throw error;
  }
}

export class QuotaService {
  private readonly GET_USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
  //   private readonly COMMAND_MODEL_CONFIG_PATH = '/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs';

  // 重试配置
  private readonly MAX_RETRY_COUNT = 3;
  private readonly RETRY_DELAY_MS = 5000; // 5秒

  // Primary HTTPS Connect port
  private port: number;
  // Optional HTTP fallback port (extension_server_port)
  private httpPort?: number;
  private pollingInterval?: NodeJS.Timeout;
  private updateCallback?: (snapshot: QuotaSnapshot) => void;
  private errorCallback?: (error: Error) => void;
  private statusCallback?: (status: 'fetching' | 'retrying', retryCount?: number) => void;
  private authStatusCallback?: (needsLogin: boolean, isExpired: boolean) => void;
  private staleCallback?: (isStale: boolean) => void;
  private isFirstAttempt: boolean = true;
  private consecutiveErrors: number = 0;
  private retryCount: number = 0;
  // 记录是否至少成功获取过一次配额，用于首次失败时直显错误
  private hasSuccessfulFetch: boolean = false;
  private isRetrying: boolean = false;
  private isPollingTransition: boolean = false;  // 轮询状态切换锁，防止竞态条件
  private csrfToken?: string;
  private googleAuthService: GoogleAuthService;
  private googleApiClient: GoogleCloudCodeClient;
  private apiMethod: QuotaApiMethod = QuotaApiMethod.GET_USER_STATUS;

  constructor(port: number, csrfToken?: string, httpPort?: number) {
    this.port = port;
    // 只有当 httpPort 明确提供时才使用，否则保持 undefined
    // 避免 GOOGLE_API 模式下 port=0 导致 httpPort 也被设为 0
    this.httpPort = httpPort;
    this.csrfToken = csrfToken;
    this.googleAuthService = GoogleAuthService.getInstance();
    this.googleApiClient = GoogleCloudCodeClient.getInstance();
  }

  getApiMethod(): QuotaApiMethod {
    return this.apiMethod;
  }

  setApiMethod(method: QuotaApiMethod): void {
    this.apiMethod = method;
    logger.info('QuotaService', `Switching to API: ${method}`);
  }

  setAuthInfo(_unused?: any, csrfToken?: string): void {
    this.csrfToken = csrfToken;
  }

  setPort(port: number): void {
    this.port = port;
    this.httpPort = this.httpPort ?? port;
    this.consecutiveErrors = 0;
    this.retryCount = 0;
  }

  setPorts(connectPort: number, httpPort?: number): void {
    this.port = connectPort;
    this.httpPort = httpPort ?? connectPort;
    this.consecutiveErrors = 0;
    this.retryCount = 0;
  }

  onQuotaUpdate(callback: (snapshot: QuotaSnapshot) => void): void {
    this.updateCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onStatus(callback: (status: 'fetching' | 'retrying', retryCount?: number) => void): void {
    this.statusCallback = callback;
  }

  /**
   * 设置认证状态回调 (仅用于 GOOGLE_API 方法)
   * @param callback 回调函数，参数: needsLogin - 需要登录, isExpired - Token 已过期
   */
  onAuthStatus(callback: (needsLogin: boolean, isExpired: boolean) => void): void {
    this.authStatusCallback = callback;
  }

  /**
   * 设置数据过时回调 (仅用于 GOOGLE_API 方法)
   * @param callback 回调函数，参数: isStale - 数据是否过时
   */
  onStaleStatus(callback: (isStale: boolean) => void): void {
    this.staleCallback = callback;
  }

  async startPolling(intervalMs: number): Promise<void> {
    logger.info('QuotaService', `startPolling called with interval=${intervalMs}ms, apiMethod=${this.apiMethod}`);

    // GOOGLE_API 模式：未登录或 token 过期时不启动轮询，避免无意义请求
    if (this.apiMethod === QuotaApiMethod.GOOGLE_API) {
      const authState = this.googleAuthService.getAuthState();
      logger.debug('QuotaService', `GOOGLE_API auth state: ${authState.state}`);
      if (authState.state === AuthState.NOT_AUTHENTICATED || authState.state === AuthState.TOKEN_EXPIRED) {
        logger.info('QuotaService', `Polling skipped: auth state=${authState.state}`);
        if (this.authStatusCallback) {
          this.authStatusCallback(true, authState.state === AuthState.TOKEN_EXPIRED);
        }
        this.stopPolling();
        this.consecutiveErrors = 0;
        this.retryCount = 0;
        this.isRetrying = false;
        return;
      }
    }

    // 防止快速连续调用导致多个定时器
    if (this.isPollingTransition) {
      logger.debug('QuotaService', 'Polling transition in progress, skipping...');
      return;
    }

    this.isPollingTransition = true;
    try {
      logger.info('QuotaService', `Starting polling loop every ${intervalMs}ms`);
      this.stopPolling();
      await this.fetchQuota();
      this.pollingInterval = setInterval(() => {
        this.fetchQuota();
      }, intervalMs);
    } finally {
      this.isPollingTransition = false;
    }
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      logger.info('QuotaService', 'Stopping polling loop');
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * 手动重试获取配额(重置所有状态,重新开始完整流程)
   * 成功后会自动恢复轮询
   */
  async retryFromError(pollingInterval: number): Promise<void> {
    logger.info('QuotaService', `Manual quota retry triggered; restarting full flow (interval ${pollingInterval}ms)...`);
    // 重置所有错误计数和状态
    this.consecutiveErrors = 0;
    this.retryCount = 0;
    this.isRetrying = false;
    this.isFirstAttempt = true;

    // 先停止现有轮询
    this.stopPolling();

    // 执行一次获取,如果成功会自动开启轮询
    await this.fetchQuota();

    // 如果获取成功(consecutiveErrors为0),启动轮询
    if (this.consecutiveErrors === 0) {
      logger.info('QuotaService', 'Fetch succeeded, starting polling...');
      this.pollingInterval = setInterval(() => {
        this.fetchQuota();
      }, pollingInterval);
    } else {
      logger.warn('QuotaService', 'Fetch failed, keeping polling stopped');
    }
  }

  /**
   * 立即刷新配额(保持轮询不中断)
   * 用于用户手动触发快速刷新,不会重置错误状态
   */
  async quickRefresh(): Promise<void> {
    logger.info('QuotaService', 'Triggering immediate quota refresh...');
    // 直接调用内部获取方法,绕过 isRetrying 检查
    await this.doFetchQuota();
  }

  private async fetchQuota(): Promise<void> {
    // 如果正在重试中，跳过本次调用
    if (this.isRetrying) {
      logger.debug('QuotaService', 'Currently retrying; skipping this polling run...');
      return;
    }

    await this.doFetchQuota();
  }

  /**
   * 实际执行配额获取的内部方法
   * quickRefresh 和 fetchQuota 都调用此方法
   */
  private async doFetchQuota(): Promise<void> {
    logger.debug('QuotaService', `doFetchQuota: method=${this.apiMethod}, firstAttempt=${this.isFirstAttempt}, retryCount=${this.retryCount}`);

    // 通知状态: 正在获取 (仅首次)
    if (this.statusCallback && this.isFirstAttempt) {
      this.statusCallback('fetching');
    }

    try {
      // 注意: 登录状态检测已禁用
      // 原因: GetUnleashData API 需要完整的认证上下文(API key等)，插件无法获取
      // 如果用户未登录，获取配额时会自然失败并显示错误信息
      //
      // 保留原代码供参考:
      // const isLoggedIn = await this.checkLoginStatus();
      // if (!isLoggedIn) {
      //   console.warn('用户未登录，无法获取配额信息');
      //   if (this.loginStatusCallback) {
      //     this.loginStatusCallback(false);
      //   }
      //   this.consecutiveErrors = 0;
      //   this.retryCount = 0;
      //   this.isFirstAttempt = false;
      //   return;
      // }

      let snapshot: QuotaSnapshot;
      switch (this.apiMethod) {
        case QuotaApiMethod.GOOGLE_API: {
          logger.debug('QuotaService', 'Using Google API (direct)');
          // Google API 方法有特殊的认证处理逻辑
          const result = await this.handleGoogleApiQuota();
          if (result === null) {
            // 认证问题，已通知回调，直接返回（不进入重试）
            logger.info('QuotaService', 'Google API returned null (auth issue), skipping update');
            return;
          }
          snapshot = result;
          break;
        }
        case QuotaApiMethod.GET_USER_STATUS: {
          logger.debug('QuotaService', 'Using GetUserStatus API');
          const userStatusResponse = await this.makeGetUserStatusRequest();
          const invalid1 = this.getInvalidCodeInfo(userStatusResponse);
          if (invalid1) {
            logger.error('QuotaService', `Response code invalid: code=${invalid1.code}, message=${invalid1.message}`);
            const detail = invalid1.message ? `: ${invalid1.message}` : '';
            const err = new Error(`Invalid response code ${invalid1.code}${detail}`);
            err.name = 'QuotaInvalidCodeError';
            throw err;
          }
          snapshot = this.parseGetUserStatusResponse(userStatusResponse);
          break;
        }
        //         case QuotaApiMethod.COMMAND_MODEL_CONFIG:
        //         default: {
        //           console.log('Using CommandModelConfig API (recommended)');
        //           const configResponse = await this.makeCommandModelConfigsRequest();
        //           const invalid2 = this.getInvalidCodeInfo(configResponse);
        //           if (invalid2) {
        //             console.error('Response code invalid; skipping update', invalid2);
        //             return;
        //           }
        //           snapshot = this.parseCommandModelConfigsResponse(configResponse);
        //           break;
        //         }
        default: {
          // 默认回退到 GET_USER_STATUS
          logger.debug('QuotaService', 'Falling back to GetUserStatus API');
          const userStatusResponse = await this.makeGetUserStatusRequest();
          const invalid1 = this.getInvalidCodeInfo(userStatusResponse);
          if (invalid1) {
            logger.error('QuotaService', `Response code invalid: code=${invalid1.code}, message=${invalid1.message}`);
            const detail = invalid1.message ? `: ${invalid1.message}` : '';
            const err = new Error(`Invalid response code ${invalid1.code}${detail}`);
            err.name = 'QuotaInvalidCodeError';
            throw err;
          }
          snapshot = this.parseGetUserStatusResponse(userStatusResponse);
          break;
        }
      }

      // 成功获取配额，重置错误计数和重试计数
      this.consecutiveErrors = 0;
      this.retryCount = 0;
      this.isFirstAttempt = false;

      // 清除过时标志 (仅 GOOGLE_API 方法)
      if (this.apiMethod === QuotaApiMethod.GOOGLE_API && this.staleCallback) {
        this.staleCallback(false);
      }

      const modelCount = snapshot.models?.length ?? 0;
      const hasPromptCredits = Boolean(snapshot.promptCredits);
      logger.info('QuotaService', `Quota fetched successfully: models=${modelCount}, hasPromptCredits=${hasPromptCredits}, planName=${snapshot.planName || 'N/A'}`);

      // 标记成功获取过数据，后续可区分“首次失败”场景
      this.hasSuccessfulFetch = true;

      if (this.updateCallback) {
        this.updateCallback(snapshot);
      } else {
        logger.warn('QuotaService', 'updateCallback is not registered');
      }
    } catch (error: any) {
      this.consecutiveErrors++;
      logger.error('QuotaService', `Quota fetch failed (attempt ${this.consecutiveErrors}): ${error.message}`);
      if (error?.stack) {
        logger.debug('QuotaService', `Stack: ${error.stack}`);
      }

      // GOOGLE_API 模式：认证问题时直接停止轮询，等待用户重新登录，不进入重试
      if (this.apiMethod === QuotaApiMethod.GOOGLE_API && this.isAuthError(error)) {
        logger.info('QuotaService', 'Google API: Auth issue detected, stopping polling until login');
        if (this.authStatusCallback) {
          const message = (error?.message || '').toLowerCase();
          const isExpired = message.includes('expired') || message.includes('invalid_grant');
          this.authStatusCallback(true, isExpired);
        }
        this.stopPolling();
        this.isRetrying = false;
        this.retryCount = 0;
        this.isFirstAttempt = false;
        return;
      }

      // GOOGLE_API 方法: 网络错误/超时时设置过时标志，不停止轮询
      if (this.apiMethod === QuotaApiMethod.GOOGLE_API) {
        const isNetworkError = this.isNetworkOrTimeoutError(error);
        if (isNetworkError) {
          logger.warn('QuotaService', 'Google API: Network/timeout error, marking data as stale');
          // 首次请求即失败时，直接抛给错误回调以触发状态栏红色错误态
          if (!this.hasSuccessfulFetch && this.errorCallback) {
            this.errorCallback(error as Error);
          }
          if (this.staleCallback) {
            this.staleCallback(true);
          }
          // 重置重试计数，继续轮询
          this.retryCount = 0;
          this.isFirstAttempt = false;
          return;
        }
      }

      // 如果还没达到最大重试次数，进行延迟重试
      if (this.retryCount < this.MAX_RETRY_COUNT) {
        this.retryCount++;
        this.isRetrying = true;
        logger.info('QuotaService', `Retry ${this.retryCount}/${this.MAX_RETRY_COUNT} scheduled in ${this.RETRY_DELAY_MS / 1000}s`);

        // 通知状态: 正在重试
        if (this.statusCallback) {
          this.statusCallback('retrying', this.retryCount);
        }

        setTimeout(async () => {
          this.isRetrying = false;
          await this.fetchQuota();
        }, this.RETRY_DELAY_MS);
        return;
      }

      // 达到最大重试次数,停止轮询
      logger.error('QuotaService', `Reached max retry count (${this.MAX_RETRY_COUNT}); stopping polling`);
      this.stopPolling(); // 停止定时轮询

      if (this.errorCallback) {
        this.errorCallback(error as Error);
      }
    }
  }

  /**
   * 判断是否为网络错误或超时错误
   */
  private isNetworkOrTimeoutError(error: any): boolean {
    const message = (error?.message || '').toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ENOTFOUND' ||
      error?.code === 'ECONNRESET' ||
      error?.code === 'ETIMEDOUT'
    );
  }

  /**
   * 判断是否为认证相关错误（需要登录/重新登录）
   */
  private isAuthError(error: any): boolean {
    if (error instanceof GoogleApiError && error.needsReauth()) {
      return true;
    }
    const message = (error?.message || '').toLowerCase();
    return message.includes('not authenticated') || message.includes('unauthorized') || message.includes('invalid_grant');
  }

  private async makeGetUserStatusRequest(): Promise<any> {
    logger.debug('QuotaService', 'Using CSRF token', { csrf: this.csrfToken ? '[present]' : '[missing]' });
    const ideVer = versionInfo.getIdeVersion();
    const isV2 = ideVer.startsWith('2.');
    return makeRequest(
      {
        path: this.GET_USER_STATUS_PATH,
        body: {
          metadata: {
            ideName: isV2 ? 'antigravity-ide' : 'antigravity',
            extensionName: 'antigravity',
            ideVersion: ideVer,
            locale: 'en'
          }
        }
      },
      this.port,
      this.httpPort,
      this.csrfToken
    );
  }

  //   private async makeCommandModelConfigsRequest(): Promise<any> {
  //     console.log('Using CSRF token:', this.csrfToken ? '[present]' : '[missing]');
  //     return makeRequest(
  //       {
  //         path: this.COMMAND_MODEL_CONFIG_PATH,
  //         body: {
  //           metadata: {
  //             ideName: 'antigravity',
  //             extensionName: 'antigravity',
  //             locale: 'en'
  //           }
  //         }
  //       },
  //       this.port,
  //       this.httpPort,
  //       this.csrfToken
  //     );
  //   }

  /**
   * 处理 Google API 配额获取
   * 分离认证问题和 API 错误：
   * - 认证问题（未登录/过期）：通知回调并返回 null，不触发重试
   * - API 错误：返回异常，由外层处理重试
   * @returns QuotaSnapshot 或 null（认证问题时返回 null）
   */
  private async handleGoogleApiQuota(): Promise<QuotaSnapshot | null> {
    const authState = this.googleAuthService.getAuthState();
    logger.debug('QuotaService', `handleGoogleApiQuota: authState=${authState.state}`);

    // 检查认证状态 - 认证问题直接返回 null，不进入重试逻辑
    if (authState.state === AuthState.NOT_AUTHENTICATED) {
      logger.info('QuotaService', 'Google API: Not authenticated, showing login prompt');
      if (this.authStatusCallback) {
        this.authStatusCallback(true, false);
      }
      // 重置状态，不算作错误
      this.isFirstAttempt = false;
      return null;
    }

    if (authState.state === AuthState.TOKEN_EXPIRED) {
      logger.info('QuotaService', 'Google API: Token expired, showing re-auth prompt');
      if (this.authStatusCallback) {
        this.authStatusCallback(true, true);
      }
      // 重置状态，不算作错误
      this.isFirstAttempt = false;
      return null;
    }

    if (authState.state === AuthState.AUTHENTICATING || authState.state === AuthState.REFRESHING) {
      logger.debug('QuotaService', 'Google API: Authentication in progress, skipping this cycle');
      // 正在认证中，跳过本次，不算错误也不返回数据
      return null;
    }

    // 已认证，尝试获取配额（API 错误会抛出异常，由外层重试处理）
    logger.debug('QuotaService', 'Google API: Authenticated, fetching quota...');
    return await this.fetchQuotaViaGoogleApi();
  }

  /**
   * 通过 Google API 直接获取配额
   * 调用此方法前应确保已通过认证检查
   */
  private async fetchQuotaViaGoogleApi(): Promise<QuotaSnapshot> {
    try {
      // 获取有效的 access token (会自动刷新)
      logger.debug('QuotaService', 'fetchQuotaViaGoogleApi: Getting valid access token...');
      const accessToken = await this.googleAuthService.getValidAccessToken();

      // 获取用户信息（邮箱）
      let userEmail: string | undefined;
      try {
        const userInfo = await this.googleAuthService.fetchUserInfo(accessToken);
        userEmail = userInfo.email;
        logger.debug('QuotaService', `Google API: User email=${userEmail}`);
      } catch (e) {
        logger.warn('QuotaService', `Google API: Failed to fetch user info: ${e}`);
        // 尝试使用缓存的邮箱
        userEmail = this.googleAuthService.getUserEmail();
      }

      // 获取项目信息
      logger.debug('QuotaService', 'Google API: Loading project info...');
      const projectInfo = await this.googleApiClient.loadProjectInfo(accessToken);
      if (!projectInfo.projectId) {
        logger.warn('QuotaService', `Google API: Project ID is empty (Individual tier user without Cloud Project)`);
      }
      logger.info('QuotaService', `Google API: Project loaded, tier=${projectInfo.tier}, projectId=${projectInfo.projectId || '(empty)'}`);

      // 获取模型配额
      logger.debug('QuotaService', 'Google API: Fetching models quota...');
      const modelsQuota = await this.googleApiClient.fetchModelsQuota(accessToken, projectInfo.projectId);
      logger.info('QuotaService', `Google API: Models quota fetched, count=${modelsQuota.models.length}`);

      // 通知认证状态正常
      if (this.authStatusCallback) {
        this.authStatusCallback(false, false);
      }

      // 转换为 QuotaSnapshot
      const models: ModelQuotaInfo[] = modelsQuota.models.map((model) => {
        const resetTime = new Date(model.resetTime);
        const timeUntilReset = resetTime.getTime() - Date.now();

        return {
          label: model.displayName,
          modelId: model.modelName,
          remainingFraction: model.remainingQuota,
          remainingPercentage: model.remainingQuota * 100,
          isExhausted: model.isExhausted,
          resetTime,
          timeUntilReset,
          timeUntilResetFormatted: this.formatTimeUntilReset(timeUntilReset),
        };
      });

      return {
        timestamp: new Date(),
        promptCredits: undefined, // Google API 不直接返回 prompt credits
        models,
        planName: projectInfo.tier,
        userEmail,
        projectId: projectInfo.projectId,
      };
    } catch (error) {
      if (error instanceof GoogleApiError) {
        logger.error('QuotaService', `Google API error: status=${error.statusCode}, needsReauth=${error.needsReauth()}, message=${error.message}`);
        if (error.needsReauth()) {
          logger.info('QuotaService', 'Google API: Token invalid, need to re-authenticate');
          if (this.authStatusCallback) {
            this.authStatusCallback(true, true);
          }
        }
      }
      throw error;
    }
  }

  //   private parseCommandModelConfigsResponse(response: any): QuotaSnapshot {
  //     const modelConfigs = response?.clientModelConfigs || [];
  //     const models: ModelQuotaInfo[] = modelConfigs
  //       .filter((config: any) => config.quotaInfo)
  //       .map((config: any) => this.parseModelQuota(config));
  // 
  //     return {
  //       timestamp: new Date(),
  //       promptCredits: undefined,
  //       models,
  //       planName: undefined // CommandModelConfig API doesn't usually return plan info
  //     };
  //   }

  private parseGetUserStatusResponse(response: UserStatusResponse): QuotaSnapshot {
    if (!response || !response.userStatus) {
      throw new Error('API response format is invalid; missing userStatus');
    }

    const userStatus = response.userStatus;
    const planStatus = userStatus.planStatus;
    const modelConfigs = userStatus.cascadeModelConfigData?.clientModelConfigs || [];

    const monthlyCreditsRaw = planStatus?.planInfo?.monthlyPromptCredits;
    const availableCreditsRaw = planStatus?.availablePromptCredits;

    const monthlyCredits = monthlyCreditsRaw !== undefined ? Number(monthlyCreditsRaw) : undefined;
    const availableCredits = availableCreditsRaw !== undefined ? Number(availableCreditsRaw) : undefined;

    const promptCredits: PromptCreditsInfo | undefined =
      planStatus && monthlyCredits !== undefined && monthlyCredits > 0 && availableCredits !== undefined
        ? {
          available: availableCredits,
          monthly: monthlyCredits,
          usedPercentage: ((monthlyCredits - availableCredits) / monthlyCredits) * 100,
          remainingPercentage: (availableCredits / monthlyCredits) * 100
        }
        : undefined;

    const models: ModelQuotaInfo[] = modelConfigs
      .filter(config => config.quotaInfo)
      .map(config => this.parseModelQuota(config));

    // 使用 userTier.name 作为账号级别（如 Free、Pro 等）
    const planName = userStatus?.userTier?.name;

    return {
      timestamp: new Date(),
      promptCredits,
      models,
      planName
    };
  }

  private parseModelQuota(config: any): ModelQuotaInfo {
    const quotaInfo = config.quotaInfo;
    const remainingFraction = quotaInfo?.remainingFraction;
    const resetTime = new Date(quotaInfo.resetTime);
    const timeUntilReset = resetTime.getTime() - Date.now();

    logger.debug('QuotaService', `Model ${config.label}: resetTime=${quotaInfo.resetTime}, timeUntilReset=${timeUntilReset}ms (${timeUntilReset <= 0 ? 'EXPIRED' : 'valid'})`);

    return {
      label: config.label,
      modelId: config.modelOrAlias?.model || config.modelOrAlias?.alias || config.modelId || config.label,
      remainingFraction,
      remainingPercentage: remainingFraction !== undefined ? remainingFraction * 100 : undefined,
      isExhausted: remainingFraction === undefined || remainingFraction === 0,
      resetTime,
      timeUntilReset,
      timeUntilResetFormatted: this.formatTimeUntilReset(timeUntilReset)
    };
  }

  private formatTimeUntilReset(ms: number): string {
    if (ms <= 0) {
      return 'Expired';
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d${hours % 24}h from now`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m from now`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s from now`;
    }
    return `${seconds}s from now`;
  }

  private getInvalidCodeInfo(response: any): { code: any; message?: any } | null {
    const code = response?.code;
    if (code === undefined || code === null) {
      return null;
    }

    const okValues = [0, '0', 'OK', 'Ok', 'ok', 'success', 'SUCCESS'];
    if (okValues.includes(code)) {
      return null;
    }

    return { code, message: response?.message };
  }

  dispose(): void {
    this.stopPolling();
  }
}
