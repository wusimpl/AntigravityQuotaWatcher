# Antigravity Quota Watcher

>
> 本插件为非官方工具，与 Antigravity 没有任何关联。
> 本插件依赖于 Antigravity 语言服务器的内部实现细节，相关机制可能会随时变动。
>

> **💻 系统要求 / System Requirements**
>
> 本插件目前 现已支持 Windows-amd64/Mac/Linux 操作系统。

一个用于监控 Antigravity AI 模型使用配额的 VS Code 插件，配额信息在底部状态栏显示。

![Demo 1](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo1.png)

![Demo 2](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo2.png)

## 使用方法

[下载插件](https://github.com/wusimpl/AntigravityQuotaWatcher/releases/latest)，然后安装插件，重启 Antigravity

![Installation](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/install.png)

##  功能特点

- **实时监控**：自动检测并定时轮询配额使用情况
- **状态栏显示**：在 VS Code 底部状态栏显示当前配额
- **智能预警**：配额不足时自动变色提醒
- **自动检测**：无需手动配置，自动检测 Antigravity 服务端口和认证信息

##  配置选项

打开 VS Code 设置（`文件` > `首选项` > `设置`），搜索 `Antigravity Quota Watcher`：

### 启用自动监控
- **默认值**：`true`
- **说明**：是否启用配额监控

### 轮询间隔
- **默认值**：`60`（秒）
- **说明**：配额数据刷新频率，建议设置为 30-60 秒

### 警告阈值
- **默认值**：`50`（百分比）
- **说明**：配额低于此百分比时状态栏显示警告色（通常为黄色或橙色）

### 临界阈值
- **默认值**：`30`（百分比）
- **说明**：配额低于此百分比时状态栏显示错误色（通常为红色）

### 状态栏显示样式
- **默认值**：`progressBar`
- **选项**：
  - `progressBar`：显示进度条
  - `percentage`：显示百分比
- **说明**：选择状态栏的显示风格

### API 方法选择
- **说明**：
  - `GET_USER_STATUS`：获取完整配额信息（默认方法）
  - `COMMAND_MODEL_CONFIG`：兼容模式，信息量较少

### PowerShell 模式（仅 Windows 系统可用）
- **默认值**：`true`，如果false，则使用wmic检测进程
- **说明**：使用 PowerShell 模式检测进程
- **适用场景**：如果在 Windows 系统上遇到端口检测错误，可以尝试切换此选项。插件重启生效。


### 命令面板

按 `Ctrl+Shift+P`（Windows）或 `Cmd+Shift+P`（Mac）打开命令面板，输入以下命令：

- **Antigravity: 刷新配额** - 手动刷新配额数据
- **Antigravity: 重新检测端口** - 重新检测 Antigravity 服务端口


## 状态栏说明

状态栏显示格式：

### 1. 进度条模式 (默认)
显示格式：`🟢 Pro-L ████████ | 🔴 Claude ██░░░░░░`
直观展示剩余配额的比例。

### 2. 百分比模式
显示格式：`🟢 Pro-L: 80% | 🔴 Claude: 25%`
直接显示剩余配额的百分比数值。

每个模型前会显示状态指示符号和进度条：

### 状态指示符号

每个模型前的圆点符号表示当前配额状态：

- **🟢 绿色**：剩余配额 ≥ 50%（充足）
- **🟡 黄色**：剩余配额 30%-50%（中等）
- **🔴 红色**：剩余配额 < 30%（不足）
- **⚫ 黑色**：配额已耗尽（0%）

您可以在设置中自定义 `warningThreshold`（警告阈值）和 `criticalThreshold`（临界阈值）来调整状态符号的显示级别。

## 注意事项

- 首次启动会延迟 8 秒开始监控，避免频繁请求
- 如果状态栏显示错误，可使用"重新检测端口"命令修复
- **Windows 用户**：如果遇到端口检测错误，可以在设置中启用 `forcePowerShell` 选项，切换到 PowerShell 模式进行进程检测。暂不支持 Windows-arm64系统。

## 许可证

MIT License
