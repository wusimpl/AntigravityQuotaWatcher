# Antigravity Quota Watcher

>
> This plugin is an unofficial tool and has no affiliation with Antigravity.
> This plugin relies on internal implementation details of the Antigravity language server, which may change at any time.
>

> **💻 System Requirements**
>
> This plugin currently supports Windows-amd64/Mac/Linux operating systems, but does not support Windows-arm64 systems.

A VS Code extension for monitoring Antigravity AI model usage quotas, with quota information displayed in the bottom status bar.

![Demo 1](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo1.png)

![Demo 2](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo2-en.png)

## Installation

[Download the extension](https://github.com/wusimpl/AntigravityQuotaWatcher/releases/latest), install it, and restart Antigravity.

![Installation](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/install.png)

## Submitting Issues

Please attach log files or log screenshots when submitting issues.

How to export logs:
![Step 1](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue1.png)
![Step 2](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue2.png)


## Features

- **Real-time Monitoring**: Automatically detects and polls quota usage at regular intervals
- **Status Bar Display**: Shows current quota in the VS Code bottom status bar
- **Smart Alerts**: Automatically changes color when quota is low
- **Auto Detection**: No manual configuration needed, automatically detects Antigravity service port and authentication information

## Configuration Options

Open VS Code settings (`File` > `Preferences` > `Settings`), and search for `Antigravity Quota Watcher`:

### Enable Auto Monitoring
- **Default**: `true`
- **Description**: Whether to enable quota monitoring

### Polling Interval
- **Default**: `60` (seconds)
- **Description**: Quota data refresh frequency, recommended to set between 30-60 seconds

### Warning Threshold
- **Default**: `50` (percentage)
- **Description**: When quota falls below this percentage, the status bar displays a yellow warning symbol (🟡)

### Critical Threshold
- **Default**: `30` (percentage)
- **Description**: When quota falls below this percentage, the status bar displays a red error symbol (🔴)

### Status Bar Display Style
- **Default**: `progressBar`
- **Options**:
  - `progressBar`: Display progress bar (`████░░░░`)
  - `percentage`: Display percentage (`80%`)
  - `dots`: Display dots (`●●●○○`)
- **Description**: Choose the status bar display style

### API Method Selection
- **Description**:
  - `GET_USER_STATUS`: Get complete quota information (default method)
  - `COMMAND_MODEL_CONFIG`: Compatibility mode, less information

### PowerShell Mode (Windows only)
- **Default**: `true`, if false, uses wmic to detect processes
- **Description**: Use PowerShell mode to detect processes
- **Use Case**: If you encounter port detection errors on Windows, try toggling this option. Requires plugin restart to take effect.

### Language Settings
- **Default**: `auto`
- **Options**:
  - `auto`: Automatically follow VS Code language settings
  - `en`: English
  - `zh-cn`: Simplified Chinese
- **Description**: Set status bar language, defaults to automatically follow VS Code language
> To change the configuration settings page display language, you need to set Antigravity's language to Chinese


### Command Palette

Press `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac) to open the command palette, and enter the following commands:

- **Antigravity: Refresh Quota** - Manually refresh quota data
- **Antigravity: Re-detect Port** - Re-detect Antigravity service port


## Status Bar Explanation

Status bar display format:

### 1. Progress Bar Mode
Display format: `🟢 Pro-L ████████ | 🔴 Claude ██░░░░░░`
Visually shows the proportion of remaining quota.

### 2. Percentage Mode (Default)
Display format: `🟢 Pro-L: 80% | 🔴 Claude: 25%`
Directly displays the percentage value of remaining quota.

### 3. Dots Mode
Display format: `🟢 Pro-L ●●●●○ | 🔴 Claude ●●○○○`
Uses dots to visually represent remaining quota proportion, more concise and elegant.

### Status Indicator Symbols

The dot symbol before each model indicates the current quota status:

- **🟢 Green**: Remaining quota ≥ 50% (sufficient)
- **🟡 Yellow**: Remaining quota 30%-50% (moderate)
- **🔴 Red**: Remaining quota < 30% (insufficient)
- **⚫ Black**: Quota exhausted (0%)

You can customize `warningThreshold` and `criticalThreshold` in settings to adjust the display level of status symbols.

### Model Quota Details

Hover over the status bar to see remaining quota and next reset time for all models. Click the status bar to immediately refresh quota information.

## Notes

- First startup will delay 8 seconds before starting monitoring to avoid frequent requests
- If the status bar shows an error, use the "Re-detect Port" command to fix it
- **Windows Users**: If you encounter port detection errors, you can toggle the `forcePowerShell` option in settings.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wusimpl/AntigravityQuotaWatcher&type=Date)](https://star-history.com/#wusimpl/AntigravityQuotaWatcher&Date)

## License

MIT License
