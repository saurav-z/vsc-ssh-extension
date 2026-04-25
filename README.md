# Remote SSH (Open Source)

**Open any folder on a remote machine over SSH — directly in your favorite open-source editor.**

This extension provides full Remote SSH development support for Antigravity, VSCodium, and other VS Code forks where the proprietary Microsoft extension is unavailable.

## Overview

Microsoft's official **Remote - SSH** extension is closed-source and restricted to official Microsoft-branded builds. This extension is an open-source (MIT) replacement that enables the same full-featured remote development experience:

- 🔌 **Full remote workspace** — open any remote folder over SSH.
- 🌲 **SSH Targets panel** — manage your hosts from the sidebar.
- ⚙️ **SSH config aware** — automatically reads `~/.ssh/config`.
- 🚀 **Auto server management** — handles server binary installation on the remote host (installs to `~/.code-server`).
- 💻 **Integrated Terminal** — full terminal support on the remote machine.
- 📊 **Status Bar** — real-time connection state monitoring.

## Prerequisites

**Local machine:**
- Antigravity, VSCodium, or a compatible fork.
- Proposed APIs enabled (see Installation).
- OpenSSH client (`ssh`).

**Remote machine:**
- OpenSSH server (`sshd`).
- `curl` or `wget`.
- Supported OS: Linux (glibc), macOS, or Windows 10+.

## Installation

### 1. Enable Proposed API
Because this extension uses the `RemoteAuthorityResolver` API, you must whitelist it in your editor's runtime arguments.

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Type **Preferences: Configure Runtime Arguments** and press Enter.
3. Add the following to the `enable-proposed-api` list:
   ```json
   "enable-proposed-api": ["saurav-z.vsc-ssh-extension"]
   ```
4. Restart the editor.

### 2. Install the Extension
Install the `.vsix` package via the Extensions view (**...** menu > **Install from VSIX...**).

## Configuration

| Setting | Default | Description |
|---|---|---|
| `sshRemote.sshConfigPath` | `~/.ssh/config` | Path to SSH config file |
| `sshRemote.defaultUsername` | current user | Fallback username |
| `sshRemote.connectTimeout` | `15` | Connection timeout (seconds) |
| `sshRemote.serverInstallPath` | `~/.code-server` | Remote server install directory |

## About the Author

This project is maintained by **Saurav Phuyal**. If you find this extension useful, consider supporting my work!

- 🌐 **Website:** [saurav-phuyal.com.np](https://saurav-phuyal.com.np/)
- 📺 **YouTube:** [@trachitz](https://youtube.com/@trachitz)
- 🐙 **GitHub:** [@saurav-z](https://github.com/saurav-z)

## Development

If you want to build the extension from source:

1. Clone the repository:
   ```bash
   git clone https://github.com/saurav-z/vsc-ssh-extension.git
   cd vsc-ssh-extension
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the code:
   ```bash
   npm run compile
   ```
4. Package into a `.vsix` file:
   ```bash
   npx @vscode/vsce package --no-dependencies
   ```

## License

MIT
