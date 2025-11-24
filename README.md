# Antigravity Quota Watcher

> **⚠️ 免责声明 / Disclaimer**
>
> 本插件为非官方工具，与 Antigravity 或 Codeium 没有任何关联。
> 本插件依赖于本地语言服务的内部实现细节，相关机制可能会随时变动。使用风险自负。
>
> This extension is an unofficial tool and is NOT affiliated with, endorsed by, or connected to Antigravity or Codeium.
> It relies on the internal implementation details of the local language server, which may change at any time. Use at your own risk.

> **💻 系统要求 / System Requirements**
>
> 本插件目前 **仅支持 Windows 操作系统**。
> This extension currently supports **Windows ONLY**.

一个用于实时监控 Antigravity AI 模型使用配额的 VS Code 插件。

## ✨ 功能特点

- **实时监控**：自动检测并定时轮询配额使用情况
- **状态栏显示**：在 VS Code 底部状态栏显示当前配额
- **智能预警**：配额不足时自动变色提醒
- **自动检测**：无需手动配置，自动检测 Antigravity 服务端口和认证信息

## ⚙️ 配置选项

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

### API 方法选择
- **说明**：
  - `GET_USER_STATUS`：获取完整配额信息
  - `COMMAND_MODEL_CONFIG`：兼容模式，适用于部分环境

## 📋 使用方法

 安装插件，重启 Antigravity

### 命令面板

按 `Ctrl+Shift+P`（Windows）或 `Cmd+Shift+P`（Mac）打开命令面板，输入以下命令：

- **Antigravity: 刷新配额** - 手动刷新配额数据
- **Antigravity: 重新检测端口** - 重新检测 Antigravity 服务端口


## 🎯 状态栏说明

状态栏显示格式：`🟢 💎 Pro-L ████████ | 🔴 🤖 Claude ██░░░░░░`

每个模型前会显示状态指示符号和进度条：

### 状态指示符号

每个模型前的圆点符号表示当前配额状态：

- **🟢 绿色**：剩余配额 ≥ 50%（充足）
- **🟡 黄色**：剩余配额 30%-50%（中等）
- **🔴 红色**：剩余配额 < 30%（不足）
- **⚫ 黑色**：配额已耗尽（0%）

您可以在设置中自定义 `warningThreshold`（警告阈值）和 `criticalThreshold`（临界阈值）来调整状态符号的显示级别。

## 📝 注意事项

- 插件需要 Antigravity 客户端运行才能正常工作
- 首次启动会延迟 6 秒开始监控，避免频繁请求
- 如果状态栏显示错误，可使用"重新检测端口"命令修复

## 📄 许可证

MIT License
