# Changelog — Remote SSH (Open Source)

All notable changes to this extension will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] — 2026-04-25

### Added
- **SSH Key Deployment:** One-click setup for passwordless login.
- **Quick Terminal:** Open a remote SSH terminal directly from the sidebar.
- **Port Forwarding Manager:** Manual tunnel management for remote services.

## [1.0.0] — 2026-04-25

### Added
- Full SSH remote workspace via `RemoteAuthorityResolver` proposed API
- SSH Targets Activity Bar panel listing all `~/.ssh/config` hosts
- Auto-detect and install VS Code Server binary on remote host
- SSH port forwarding (local port → remote extension host port)
- Support for key-based auth, SSH agent, password, and keyboard-interactive (2FA)
- ProxyJump / bastion host tunnelling
- Platform detection (Linux x64/arm64/armhf, macOS, Windows) for correct server binary
- `Remote-SSH: Connect to Host…` command (Command Palette + tree panel)
- `Remote-SSH: Connect to Host in New Window` command
- `Remote-SSH: Add New SSH Host…` command
- `Remote-SSH: Open SSH Configuration File…` command
- `Remote-SSH: Remove Host` command
- `Remote-SSH: Open Terminal on Host` command (plain SSH terminal, no full workspace)
- `Remote-SSH: Copy Remote Path` command
- Status bar item showing connection state (connecting / connected / error / disconnected)
- Levelled logging output channel (`off` / `error` / `warn` / `info` / `debug` / `trace`)
- Auto-refresh of host tree when SSH config file changes on disk
- Full configuration surface: `sshConfigPath`, `defaultUsername`, `connectTimeout`,
  `enableAgentForwarding`, `serverInstallPath`, `remoteServerListenOnSocket`, `logLevel`
- Proper `resourceLabelFormatters` so remote URIs display cleanly in breadcrumbs/title
