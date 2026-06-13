# ⚙️ Configuration Options

Open VS Code settings (`File` > `Preferences` > `Settings`), and search for `Antigravity Quota Watcher`:

## Enable Auto Monitoring
- **Default**: `true`
- **Description**: Whether to enable quota monitoring

## Polling Interval
- **Default**: `60` (seconds)
- **Description**: Quota data refresh frequency, recommended to set between 30-60 seconds

## Warning Threshold
- **Default**: `50` (percentage)
- **Description**: When quota falls below this percentage, the status bar displays a yellow warning symbol (🟡)

## Critical Threshold
- **Default**: `30` (percentage)
- **Description**: When quota falls below this percentage, the status bar displays a red error symbol (🔴)

## Status Bar Display Style
- **Default**: `progressBar`
- **Options**:
  - `progressBar`: Display progress bar (`████░░░░`)
  - `percentage`: Display percentage (`80%`)
  - `dots`: Display dots (`●●●○○`)
- **Description**: Choose the status bar display style

## API Method Selection
- **Default**: `GET_USER_STATUS`
- **Options**:
  - `GOOGLE_API`: Remote mode - Directly calls Google Cloud Code API to fetch quota, data is almost real-time with fast response
  - `GET_USER_STATUS`: Local mode - Fetches quota through local Antigravity language server, has significant delay (depends on LSP)
- **Description**: Choose the quota fetching method

### Google API Usage Instructions

> [!WARNING]
> **Security Notice**: The `GOOGLE_API` method requires logging into your Google account to obtain `access token` and `refresh token`. These tokens are **sensitive credentials** - if leaked, anyone can use your `refresh token` to consume your account's AI quota.
>
> **Our Commitment**: This project is completely open-source and free. We **never store or upload any user tokens** - all credentials are stored only on your local device.
>
> **Risk Warning**: There are currently many fork versions based on this project. Please be vigilant about potential risks. Before installing any quota watching plugins, we recommend using AI tools to review its code to ensure it is safe and free of backdoors.

If you choose the `GOOGLE_API` method, you need to login with your Google account:

**Login Method**:
1. Click the bottom-right extension status bar prompt
2. Complete Google account authorization in the browser
3. After successful authorization, the extension will automatically start fetching quota

**Logout Method**:
1. Open command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type and execute `Antigravity Quota Watcher: Google Logout`

### Auto-detect Local Token

If you have already logged into your Google account in the Antigravity IDE, the plugin will automatically detect local login credentials:

1. **Not Logged In**: The plugin will detect if local Antigravity is logged in. If valid credentials are detected, a prompt will ask whether to use the local account to log in directly
2. **Logged In (using Local Token)**: If your account was imported via local Token, the plugin will periodically check for changes in local Antigravity login status:
   - If the local account is switched, a prompt will ask whether to sync the new account
   - If the local account logs out, a prompt will ask whether to sync the logout

> [!TIP]
> Local Token detection paths:
> - **Windows**: `%APPDATA%\Antigravity\User\globalStorage\state.vscdb`
> - **macOS**: `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`
> - **Linux**: `~/.config/Antigravity/User/globalStorage/state.vscdb`


## PowerShell Mode (Windows only)
- **Default**: `true`, if false, uses wmic to detect processes
- **Description**: Use PowerShell mode to detect processes
- **Use Case**: If you encounter port detection errors on Windows, try toggling this option. Requires plugin restart to take effect.

## Show Gemini Pro (G Pro) Quota
- **Default**: `true`
- **Description**: Whether to display Gemini Pro quota in the status bar

## Show Gemini Flash (G Flash) Quota
- **Default**: `true`
- **Description**: Whether to display Gemini Flash quota in the status bar

## Show Account Tier
- **Default**: `false`
- **Description**: Whether to display account tier in the status bar (e.g., Free, Pro)

## Language Settings
- **Default**: `zh-cn`
- **Options**:
  - `auto`: Automatically follow VS Code language settings
  - `en`: English
  - `zh-cn`: Simplified Chinese
- **Description**: Set status bar language, defaults to automatically follow VS Code language
> To change the configuration settings page display language, you need to set Antigravity's language to Chinese
