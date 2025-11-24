import * as https from "https";
import * as http from "http";
import { UserStatusResponse, QuotaSnapshot, PromptCreditsInfo, ModelQuotaInfo } from "./types";

// API 方法枚举
export enum QuotaApiMethod {
  COMMAND_MODEL_CONFIG = 'COMMAND_MODEL_CONFIG',
  GET_USER_STATUS = 'GET_USER_STATUS'
}

export class QuotaService {
  private readonly GET_USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
  private readonly COMMAND_MODEL_CONFIG_PATH = '/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs';
  private readonly GET_UNLEASH_DATA_PATH = '/exa.language_server_pb.LanguageServerService/GetUnleashData';

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
  private loginStatusCallback?: (isLoggedIn: boolean) => void;
  private isFirstAttempt: boolean = true;
  private consecutiveErrors: number = 0;
  private retryCount: number = 0;
  private isRetrying: boolean = false;
  private csrfToken?: string;
  private apiMethod: QuotaApiMethod = QuotaApiMethod.GET_USER_STATUS;

  constructor(port: number, csrfToken?: string, httpPort?: number) {
    this.port = port;
    this.httpPort = httpPort ?? port;
    this.csrfToken = csrfToken;
  }

  setApiMethod(method: QuotaApiMethod): void {
    this.apiMethod = method;
    console.log(`切换到 API: ${method}`);
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

  onLoginStatusChange(callback: (isLoggedIn: boolean) => void): void {
    this.loginStatusCallback = callback;
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.fetchQuota();
    this.pollingInterval = setInterval(() => {
      this.fetchQuota();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * 手动重试获取配额(重置所有状态,重新开始完整流程)
   * 成功后会自动恢复轮询
   */
  async retryFromError(pollingInterval: number): Promise<void> {
    console.log('手动重试获取配额,重新开始完整流程...');
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
      console.log('获取成功,启动轮询...');
      this.pollingInterval = setInterval(() => {
        this.fetchQuota();
      }, pollingInterval);
    } else {
      console.log('获取失败,保持停止状态');
    }
  }

  /**
   * 立即刷新配额(保持轮询不中断)
   * 用于用户手动触发快速刷新,不会重置错误状态
   */
  async quickRefresh(): Promise<void> {
    console.log('立即刷新配额...');
    // 直接调用内部获取方法,绕过 isRetrying 检查
    await this.doFetchQuota();
  }

  private async fetchQuota(): Promise<void> {
    // 如果正在重试中，跳过本次调用
    if (this.isRetrying) {
      console.log('正在重试中，跳过本次轮询...');
      return;
    }

    await this.doFetchQuota();
  }

  /**
   * 实际执行配额获取的内部方法
   * quickRefresh 和 fetchQuota 都调用此方法
   */
  private async doFetchQuota(): Promise<void> {
    console.log('开始获取配额信息...');

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
        case QuotaApiMethod.GET_USER_STATUS: {
          console.log('使用 GetUserStatus API');
          const userStatusResponse = await this.makeGetUserStatusRequest();
          const invalid1 = this.getInvalidCodeInfo(userStatusResponse);
          if (invalid1) {
            console.error('响应 code 异常，跳过更新', invalid1);
            return;
          }
          snapshot = this.parseGetUserStatusResponse(userStatusResponse);
          break;
        }
        case QuotaApiMethod.COMMAND_MODEL_CONFIG:
        default: {
          console.log('使用 CommandModelConfig API (推荐)');
          const configResponse = await this.makeCommandModelConfigsRequest();
          const invalid2 = this.getInvalidCodeInfo(configResponse);
          if (invalid2) {
            console.error('响应 code 异常，跳过更新', invalid2);
            return;
          }
          snapshot = this.parseCommandModelConfigsResponse(configResponse);
          break;
        }
      }

      // 成功获取配额，重置错误计数和重试计数
      this.consecutiveErrors = 0;
      this.retryCount = 0;
      this.isFirstAttempt = false;

      if (this.updateCallback) {
        this.updateCallback(snapshot);
      } else {
        console.warn('updateCallback 未注册');
      }
    } catch (error: any) {
      this.consecutiveErrors++;
      console.error(`配额获取失败 (第 ${this.consecutiveErrors} 次):`, error.message);

      // 如果还没达到最大重试次数，进行延迟重试
      if (this.retryCount < this.MAX_RETRY_COUNT) {
        this.retryCount++;
        this.isRetrying = true;
        console.log(`将在 ${this.RETRY_DELAY_MS / 1000} 秒后进行第 ${this.retryCount} 次重试...`);

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
      console.error(`已达到最大重试次数 (${this.MAX_RETRY_COUNT}),停止轮询`);
      this.stopPolling(); // 停止定时轮询

      if (this.errorCallback) {
        this.errorCallback(error as Error);
      }
    }
  }

  /**
   * 检查用户登录状态
   * 通过 GetUnleashData API 检测，如果响应中包含 userId 则表示已登录
   */
  private async checkLoginStatus(): Promise<boolean> {
    try {
      const response = await this.makeGetUnleashDataRequest();

      // 打印完整响应
      console.log('GetUnleashData 完整响应:', JSON.stringify(response, null, 2));

      // 检查响应中是否包含 userId
      const userId = response?.context?.userId;
      const hasUserId = userId !== undefined && userId !== null && userId !== '';

      console.log(`登录状态检测: ${hasUserId ? '已登录' : '未登录'}`);
      if (hasUserId) {
        console.log(`用户 ID: ${userId?.substring(0, 20)}...`);
      }

      return hasUserId;
    } catch (error: any) {
      console.error('登录状态检测失败:', error.message);
      // 如果检测失败，假设未登录
      return false;
    }
  }

  /**
   * 调用 GetUnleashData API
   */
  private async makeGetUnleashDataRequest(): Promise<any> {
    const requestBody = JSON.stringify({
      ideName: "antigravity",
      locale: "en",
      ideVersion: "1.11.2",
      extensionName: "antigravity"
    });

    const headers: any = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      'Connect-Protocol-Version': '1'
    };

    if (this.csrfToken) {
      headers['X-Codeium-Csrf-Token'] = this.csrfToken;
    } else {
      throw new Error('缺少 CSRF Token');
    }

    const doRequest = (useHttps: boolean, port: number) => new Promise((resolve, reject) => {
      const options: any = {
        hostname: '127.0.0.1',
        port,
        path: this.GET_UNLEASH_DATA_PATH,
        method: 'POST',
        headers
      };

      if (useHttps) {
        options.rejectUnauthorized = false;
      }

      console.log(`请求地址: ${useHttps ? 'https' : 'http'}://127.0.0.1:${port}${this.GET_UNLEASH_DATA_PATH}`);

      const client = useHttps ? https : http;
      const req = client.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP 错误: ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`解析响应失败: ${error}`));
          }
        });
      });

      req.on('error', (error: any) => reject(error));
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.setTimeout(5000);
      req.write(requestBody);
      req.end();
    });

    try {
      return await doRequest(true, this.port);
    } catch (error: any) {
      const msg = (error?.message || '').toLowerCase();
      const shouldRetryHttp = this.httpPort !== undefined && (error.code === 'EPROTO' || msg.includes('wrong_version_number'));
      if (shouldRetryHttp) {
        console.warn('HTTPS 失败，尝试 HTTP fallback 端口:', this.httpPort);
        return await doRequest(false, this.httpPort!);
      }
      throw error;
    }
  }

  private async makeGetUserStatusRequest(): Promise<any> {
    const requestBody = JSON.stringify({
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        locale: 'en'
      }
    });

    const headers: any = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      'Connect-Protocol-Version': '1'
    };

    if (this.csrfToken) {
      headers['X-Codeium-Csrf-Token'] = this.csrfToken;
      console.log('使用 CSRF token:', this.csrfToken.substring(0, 4) + '...');
    } else {
      throw new Error('缺少 CSRF Token');
    }

    const doRequest = (useHttps: boolean, port: number) => new Promise((resolve, reject) => {
      const options: any = {
        hostname: '127.0.0.1',
        port,
        path: this.GET_USER_STATUS_PATH,
        method: 'POST',
        headers
      };

      if (useHttps) {
        options.rejectUnauthorized = false;
      }

      console.log(`请求地址: ${useHttps ? 'https' : 'http'}://127.0.0.1:${port}${this.GET_USER_STATUS_PATH}`);
      // console.log('请求头:', JSON.stringify(headers, null, 2));
      // console.log('请求体:', requestBody);

      const client = useHttps ? https : http;
      const req = client.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP 错误: ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`解析响应失败: ${error}`));
          }
        });
      });

      req.on('error', (error: any) => reject(error));
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.setTimeout(5000);
      req.write(requestBody);
      req.end();
    });

    try {
      return await doRequest(true, this.port);
    } catch (error: any) {
      const msg = (error?.message || '').toLowerCase();
      const shouldRetryHttp = this.httpPort !== undefined && (error.code === 'EPROTO' || msg.includes('wrong_version_number'));
      if (shouldRetryHttp) {
        console.warn('HTTPS 失败，尝试 HTTP fallback 端口:', this.httpPort);
        return await doRequest(false, this.httpPort!);
      }
      throw error;
    }
  }

  private async makeCommandModelConfigsRequest(): Promise<any> {
    const requestBody = JSON.stringify({
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        locale: 'en'
      }
    });

    const headers: any = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      'Connect-Protocol-Version': '1'
    };

    if (this.csrfToken) {
      headers['X-Codeium-Csrf-Token'] = this.csrfToken;
      console.log('使用 CSRF token:', this.csrfToken.substring(0, 4) + '...');
    } else {
      throw new Error('缺少 CSRF Token');
    }

    const doRequest = (useHttps: boolean, port: number) => new Promise((resolve, reject) => {
      const options: any = {
        hostname: '127.0.0.1',
        port,
        path: this.COMMAND_MODEL_CONFIG_PATH,
        method: 'POST',
        headers
      };
      if (useHttps) {
        options.rejectUnauthorized = false;
      }

      console.log(`请求地址: ${useHttps ? 'https' : 'http'}://127.0.0.1:${port}${this.COMMAND_MODEL_CONFIG_PATH}`);
      console.log('请求头:', JSON.stringify(headers, null, 2));
      console.log('请求体:', requestBody);

      const client = useHttps ? https : http;
      const req = client.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP 错误: ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`解析响应失败: ${error}`));
          }
        });
      });

      req.on('error', (error: any) => reject(error));
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.setTimeout(5000);
      req.write(requestBody);
      req.end();
    });

    try {
      return await doRequest(true, this.port);
    } catch (error: any) {
      const msg = (error?.message || '').toLowerCase();
      const shouldRetryHttp = this.httpPort !== undefined && (error.code === 'EPROTO' || msg.includes('wrong_version_number'));
      if (shouldRetryHttp) {
        console.warn('HTTPS 失败，尝试 HTTP fallback 端口:', this.httpPort);
        return await doRequest(false, this.httpPort!);
      }
      throw error;
    }
  }

  private parseCommandModelConfigsResponse(response: any): QuotaSnapshot {
    const modelConfigs = response?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = modelConfigs
      .filter((config: any) => config.quotaInfo)
      .map((config: any) => this.parseModelQuota(config));

    return {
      timestamp: new Date(),
      promptCredits: undefined,
      models
    };
  }

  private parseGetUserStatusResponse(response: UserStatusResponse): QuotaSnapshot {
    if (!response || !response.userStatus) {
      throw new Error('API 响应格式不正确，缺少 userStatus');
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

    return {
      timestamp: new Date(),
      promptCredits,
      models
    };
  }

  private parseModelQuota(config: any): ModelQuotaInfo {
    const quotaInfo = config.quotaInfo;
    const remainingFraction = quotaInfo?.remainingFraction;
    const resetTime = new Date(quotaInfo.resetTime);
    const timeUntilReset = resetTime.getTime() - Date.now();

    return {
      label: config.label,
      modelId: config.modelOrAlias.model,
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
      return '已过期';
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}天${hours % 24}小时后`;
    } else if (hours > 0) {
      return `${hours}小时${minutes % 60}分钟后`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds % 60}秒后`;
    }
    return `${seconds}秒后`;
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
