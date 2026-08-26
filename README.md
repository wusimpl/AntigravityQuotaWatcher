# <img src="./icon.png" width="80" style="vertical-align: middle"> Antigravity Quota Watcher

#### Choose Your Language:  简体中文 | [English](./README.en.md)

> [!WARNING]
> **关于配额不刷新（一直显示100%）问题的公告**
>
> 近期有用户反馈配额一直显示100%不刷新的问题，推测可能是官方接口机制变更导致。
>
> **临时解决方案**：~~将代理节点设置为美国地区的节点~~,该方法目前似乎也已经失效，目前的配额递减规律是20%更新一次，100%->80%->60%...。

> [!NOTE]
> 号外号外！本仓库为vscode插件版，[桌面版](https://github.com/wusimpl/AntigravityQuotaWatcherDesktop)已发布，欢迎下载体验

**一个在Antigravity状态栏实时显示AI模型配额剩余情况的插件。**

## 演示

<table>
  <tr>
    <td align="center">
      <strong>状态栏显示</strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo1.png" alt="状态栏显示" width="300">
    </td>
    <td align="center">
      <strong>配额详情</strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo2.png" alt="配额详情" width="400">
    </td>
    <td align="center">
      <strong>配置页面<a href="./CONFIG.md">(配置文档)</a></strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo3.png" alt="配置页面" width="400">
    </td>
  </tr>
</table>

## 系统要求

![Windows](https://img.shields.io/badge/Windows--amd64-支持-brightgreen?logo=microsoftwindows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-支持-brightgreen?logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-支持-brightgreen?logo=linux&logoColor=white)
![Windows ARM](https://img.shields.io/badge/Windows--arm64-不支持-red?logo=microsoftwindows&logoColor=white)

## 安装方法


### 方式一：插件市场安装（推荐）

在插件市场搜索 `wusimpl Antigravity Quota Watcher @sort:name`，认准作者为 `wusimpl` 的插件，点击安装即可。

![OpenVSX-Search PNG](./images/openvsx-search.png)

### 方式二：手动安装

[下载插件](https://github.com/wusimpl/AntigravityQuotaWatcher/releases/latest)，然后安装插件，重启 Antigravity

![Installation](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/install.png)

> [!NOTE]
> Linux系统平台须知：请确保系统支持以下三种命令之一：`lsof`、`netstat`、`ss`。如果没有，请安装后再重启IDE。

## 提交Issue

<details>
<summary>点击展开</summary>

请在提交issue时附上日志文件或者日志截图

日志导出方法：
![步骤页面1](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue1.png)
![步骤页面2](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue2.png)

</details>


##  功能特点

- **实时监控**：自动检测并定时轮询配额使用情况
- **状态栏显示**：在 VS Code 底部状态栏显示当前配额
- **智能预警**：配额不足时自动变色提醒
- **自动检测**：无需手动配置，自动检测 Antigravity 服务端口和认证信息
- **本地登录同步**：自动检测 Antigravity IDE 的登录状态，支持一键导入本地账号凭证
- **Dashboard 面板**：提供配额概览、连接状态、周限检测等功能

## Dashboard

通过命令面板执行 `Antigravity Quota Watcher: Open Dashboard` 可打开 Dashboard 面板，提供以下功能：

- **配额概览**：以表格形式展示所有模型的剩余配额和重置时间
- **连接状态**：显示当前 API 模式、端口信息、轮询状态等
- **账号信息**：显示当前登录账号和订阅计划
- **快捷操作**：刷新配额、重新检测端口、登录/登出等

<img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/dashboard.jpg" alt="Dashboard" width="500">

<details>
<summary><b>周限检测</b>（点击展开）</summary>

在 Dashboard 面板中，可以对每个模型池进行周限检测，判断是否触发了周配额限制。

> ⚠️ 周限检测会发送一次测试请求，会消耗少量配额。

**配额池划分：**
- Gemini 3.x 池
- Claude / GPT 池
- Gemini 2.5 池

**判断逻辑：**

```
                    发送测试请求（提示词为"Hi"）
                                │
                                ▼
                        HTTP 状态码？
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
           200                 429                其他
            │                   │                   │
            ▼                   ▼                   ▼
        ✅ 配额            解析 error            ❓ 未知
           正常              .details              错误
                                │
                                ▼
                           reason 是？
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
      QUOTA_EXHAUSTED    RATE_LIMIT_       MODEL_CAPACITY_
            │              EXCEEDED           EXHAUSTED
            │                   │                   │
            ▼                   ▼                   ▼
       重置时间多久？       ⚠️ 请求太频繁      ⚠️ 服务器过载
            │                                  请稍后重试
       ┌────┴────┐
       │         │
       ▼         ▼
      >5h       ≤5h
       │         │
       ▼         ▼
    ❌ 周限   ⚠️ 5h限速
```

</details>

##  配置选项

详细配置说明请查看：**[📖 配置文档](./CONFIG.md)**


### 命令面板
命令面板支持手动调用一些命令，这些命令用于排错和调用不常用的功能。
按 `Ctrl+Shift+P`（Windows）或 `Cmd+Shift+P`（Mac）打开命令面板，支持以下命令：

**通用命令：**
- **Antigravity Quota Watcher: Refresh Quota** - 手动刷新配额数据
- **Antigravity Quota Watcher: Open Dashboard** - 打开 Dashboard 面板

**仅适用于 GET_USER_STATUS 方式的命令：**
- **Antigravity Quota Watcher: Re-detect Port** - 重新检测 Antigravity 服务端口

**仅适用于 GOOGLE_API 方式的命令：**
- **Antigravity Quota Watcher: Login with Google** - 使用 Google 账号登录
- **Antigravity Quota Watcher: Logout from Google** - 登出 Google 账号


## 状态栏说明

<details>
<summary>点击展开</summary>

状态栏显示格式：

### 1. 进度条模式
显示格式：`🟢 Pro-L ████████ | 🔴 Claude ██░░░░░░`
直观展示剩余配额的比例。

### 2. 百分比模式（默认）
显示格式：`🟢 Pro-L: 80% | 🔴 Claude: 25%`
直接显示剩余配额的百分比数值。

### 3. 圆点模式
显示格式：`🟢 Pro-L ●●●●○ | 🔴 Claude ●●○○○`
使用圆点直观表示剩余配额比例，更加简洁美观。

### 状态指示符号

每个模型前的圆点符号表示当前配额状态：

- **🟢 绿色**：剩余配额 ≥ 50%（充足）
- **🟡 黄色**：剩余配额 30%-50%（中等）
- **🔴 红色**：剩余配额 < 30%（不足）
- **⚫ 黑色**：配额已耗尽（0%）

您可以在设置中自定义 `warningThreshold`（警告阈值）和 `criticalThreshold`（临界阈值）来调整状态符号的显示级别。

### 模型配额详情

鼠标移动到状态栏会显示所有模型的剩余配额与下次重置时间。**点击状态栏可以立即刷新配额信息**。

</details>

## 代理设置

<details>
<summary>点击展开</summary>

适用于未开启tun模式，使用proxifer对antigravity代理的类似用户。
首先需要明确的是，antigravity内置代理支持功能，可通过 `http.proxySupport` 设置控制：

| 设置值 | 说明 |
|--------|------|
| `override`| **自动使用操作系统的代理设置**。如果你已经在代理软件中设置了系统代理，antigravity 会自动检测并使用，无需额外配置。 |
| `on` | 使用 `http.proxy` 中手动配置的代理 |
| `fallback` | 先尝试直连，失败后使用代理 |
| `off` | 完全不使用代理 |

**插件会自动继承 antigravity 的代理设置**。如果你的 antigravity 已经能正常通过代理访问网络，本插件也会自动使用相同的代理，无需额外配置。

特殊情况下，如果需要为本插件单独配置代理，可以使用插件单独的代理配置功能：
**使用环境变量代理**：启用 `proxyEnabled` 和 `proxyAutoDetect`，插件会自动读取 `HTTPS_PROXY` 或 `HTTP_PROXY` 环境变量
或者
**手动指定代理**：启用 `proxyEnabled`，然后填写 `proxyUrl`

</details>

## 注意事项

- 首次启动会延迟 8 秒开始监控，避免频繁请求
- 如果状态栏显示错误，可使用"重新检测端口"命令修复
- **Windows 用户**：如果遇到端口检测错误，可以在设置中切换 `forcePowerShell` 选项。
- 本插件为非官方工具，与 Antigravity 没有任何关联。本插件部分依赖于 Antigravity 语言服务器的内部实现细节，相关机制可能会随时变动。
- 本插件从V0.9.0版本开始支持 VS Code fork IDE（WindSurf, Kiro, VS Code 等）。如需使用，请在配置中切换到**GOOGLE_API**方式获取模型配额，该方法不依赖于 Antigravity 本地环境，远程SSH项目也适合这种方法。

## 🔗 推荐相关生态项目
* [Antigravity Context Meter](https://github.com/Dunphil692/antigravity-context-meter) - 实时上下文用量监控与 0 遗忘会话迁移工具 (Real-time Context Usage Meter & Zero-Loss Session Migration).

## 致谢
 * Google API 配额获取方法来自 [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 项目，感谢作者的贡献！
 * 参考了 [anti-quota](https://github.com/fhyfhy17/anti-quota) 获取 Antigravity 本地登录账号Token的方法，感谢作者的贡献！
 * 周限检测功能参考了 [gcli2api](https://github.com/su-kaka/gcli2api) 项目的 2api 方法，感谢作者的贡献！

[![Star History Chart](https://api.star-history.com/svg?repos=wusimpl/AntigravityQuotaWatcher&type=date&legend=top-left)](https://www.star-history.com/#wusimpl/AntigravityQuotaWatcher&type=date&legend=top-left)

## 项目使用约定

本项目基于 MIT 协议开源，使用此项目时请遵守开源协议。  
除此外，希望你在使用代码时已经了解以下额外说明：

1. 打包、二次分发 **请保留代码出处**：[https://github.com/wusimpl/AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher)
2. 请不要用于商业用途，合法合规使用代码
3. 如果开源协议变更，将在此 Github 仓库更新，不另行通知。

## 许可证

MIT License
