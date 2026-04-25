/**
 * RemoteAuthorityResolver implementation.
 * Manages SSH connection lifecycle, remote platform detection, and TCP port forwarding.
 */
import * as vscode from 'vscode';
import * as os from 'os';
import { Client as SshClient, ConnectConfig } from 'ssh2';
import { SshConfigManager, SshHostEntry } from './sshConfig';
import { ServerManager } from './serverManager';
import { Logger } from './logger';
import { StatusBar } from './statusBar';

export class RemoteAuthorityResolverImpl {
    private connections: Map<string, { client: SshClient; localPort: number }> = new Map();
    public onClientConnected?: (client: SshClient) => void;

    constructor(
        private readonly serverManager: ServerManager,
        private readonly configManager: SshConfigManager,
        private readonly logger: Logger,
        private readonly statusBar: StatusBar
    ) {}

    /**
     * Called by the editor when it needs to open a remote workspace.
     * authority = "ssh-remote+<hostAlias>"
     */
    async resolve(authority: string, context: any): Promise<any> {
        const hostAlias = authority.replace(/^ssh-remote\+/, '');
        this.logger.info(`Resolving remote authority for host: "${hostAlias}"`);
        this.statusBar.setConnecting(hostAlias);

        try {
            const existing = this.connections.get(hostAlias);
            if (existing) {
                this.logger.debug(`Reusing existing connection to "${hostAlias}" on local port ${existing.localPort}`);
                this.statusBar.setConnected(hostAlias);
                if (this.onClientConnected) { this.onClientConnected(existing.client); }
                return this.makeResolvedAuthority('localhost', existing.localPort);
            }

            const hostEntry = this.configManager.getHost(hostAlias);
            const localPort = await this.connectAndBootstrap(hostAlias, hostEntry);

            this.statusBar.setConnected(hostAlias);
            return this.makeResolvedAuthority('localhost', localPort);
        } catch (err: any) {
            this.logger.error(`Failed to resolve authority "${hostAlias}": ${err.message}`);
            this.statusBar.setError(hostAlias);
            vscode.window.showErrorMessage(
                `Remote SSH (Open Source): Failed to connect to "${hostAlias}".\n${err.message}`,
                'Show Log'
            ).then(action => {
                if (action === 'Show Log') {
                    this.logger.show();
                }
            });
            throw err;
        }
    }

    /**
     * Manually forward a remote port to a local port.
     */
    async forwardPort(hostAlias: string, remotePort: number, localPort?: number): Promise<number> {
        const conn = this.connections.get(hostAlias);
        if (!conn) {
            throw new Error(`No active connection to "${hostAlias}".`);
        }

        const pickedLocalPort = await this.forwardRemotePort(conn.client, remotePort, localPort);
        this.logger.info(`Manual port forward established: localhost:${pickedLocalPort} → remote:${remotePort}`);
        return pickedLocalPort;
    }

    // ─── Private Helpers ──────────────────────────────────────────

    private async connectAndBootstrap(hostAlias: string, entry: SshHostEntry | undefined): Promise<number> {
        const connectCfg = await this.buildConnectConfig(hostAlias, entry);

        this.logger.info(`Connecting to ${connectCfg.host}:${connectCfg.port} as ${connectCfg.username}…`);

        const client = await this.createSshClient(connectCfg);

        // 1. Detect remote platform & architecture
        const { platform, arch } = await this.detectRemotePlatform(client);
        this.logger.info(`Remote platform: ${platform} / ${arch}`);

        // 2. Ensure server binary is installed on remote
        const serverPort = await this.serverManager.ensureServerOnRemote(client, platform, arch);

        // 3. Forward the remote server port back to a local port
        const localPort = await this.forwardRemotePort(client, serverPort);
        this.logger.info(`Port forward established: localhost:${localPort} → remote:${serverPort}`);

        // Store connection
        client.on('end', () => {
            this.logger.warn(`SSH connection to "${hostAlias}" closed.`);
            this.connections.delete(hostAlias);
            this.statusBar.setDisconnected();
        });
        this.connections.set(hostAlias, { client, localPort });

        if (this.onClientConnected) { this.onClientConnected(client); }

        return localPort;
    }

    private async buildConnectConfig(
        hostAlias: string,
        entry: SshHostEntry | undefined
    ): Promise<ConnectConfig & { host: string; port: number; username: string }> {
        const settings = vscode.workspace.getConfiguration('sshRemote');
        const timeout = (settings.get<number>('connectTimeout') ?? 15) * 1000;
        const defaultUser = settings.get<string>('defaultUsername') ?? os.userInfo().username;
        const agentForward = settings.get<boolean>('enableAgentForwarding') ?? false;

        const hostname = entry?.HostName ?? entry?.Host ?? hostAlias;
        const user = entry?.User ?? defaultUser;
        const port = entry?.Port ?? 22;

        const cfg: ConnectConfig & { host: string; port: number; username: string } = {
            host: hostname,
            port,
            username: user,
            readyTimeout: timeout,
            agentForward,
            keepaliveInterval: 10000,
            keepaliveCountMax: 6
        };

        if (entry?.IdentityFile) {
            const keyPath = entry.IdentityFile.replace('~', os.homedir());
            const { readFileSync } = await import('fs');
            try {
                cfg.privateKey = readFileSync(keyPath);
                this.logger.debug(`Using identity file: ${keyPath}`);
            } catch {
                this.logger.warn(`Could not read identity file: ${keyPath}. Falling back to agent/password.`);
            }
        }

        // Prefer ssh-agent if available
        const agentSocket = process.env.SSH_AUTH_SOCK;
        if (!cfg.privateKey && agentSocket) {
            cfg.agent = agentSocket;
            this.logger.debug(`Using SSH agent: ${agentSocket}`);
        }

        // Password fallback — prompt user if no key/agent
        if (!cfg.privateKey && !cfg.agent) {
            const pw = await vscode.window.showInputBox({
                prompt: `Password for ${user}@${hostname}`,
                password: true
            });
            if (pw === undefined) {
                throw new Error('Authentication cancelled by user.');
            }
            cfg.password = pw;
        }

        // Handle ProxyJump (bastion hosts)
        if (entry?.ProxyJump) {
            this.logger.info(`Using ProxyJump: ${entry.ProxyJump}`);
            cfg.sock = await this.openProxyStream(entry.ProxyJump, hostname, port);
        }

        return cfg;
    }

    private createSshClient(cfg: ConnectConfig): Promise<SshClient> {
        return new Promise((resolve, reject) => {
            const client = new SshClient();
            const timeout = setTimeout(() => {
                client.end();
                reject(new Error(`Connection timed out connecting to ${cfg.host}:${cfg.port}`));
            }, (cfg.readyTimeout as number) + 2000);

            client.on('ready', () => {
                clearTimeout(timeout);
                resolve(client);
            });

            client.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            client.on('keyboard-interactive', (_name, _descr, _lang, prompts, finish) => {
                // Handle keyboard-interactive auth (e.g. 2FA)
                const answers: string[] = [];
                const askNext = async (i: number) => {
                    if (i >= prompts.length) {
                        finish(answers);
                        return;
                    }
                    const prompt = prompts[i];
                    const answer = await vscode.window.showInputBox({
                        prompt: prompt.prompt,
                        password: !prompt.echo
                    });
                    answers.push(answer ?? '');
                    askNext(i + 1);
                };
                askNext(0);
            });

            client.connect(cfg);
        });
    }

    private detectRemotePlatform(client: SshClient): Promise<{ platform: string; arch: string }> {
        return new Promise((resolve, reject) => {
            client.exec('uname -sm 2>/dev/null || (cmd /c "echo Windows" 2>nul)', (err, stream) => {
                if (err) {
                    // Assume Linux x64 if detection fails
                    resolve({ platform: 'linux', arch: 'x64' });
                    return;
                }
                let output = '';
                stream.on('data', (d: Buffer) => (output += d.toString()));
                stream.stderr.on('data', () => {/* ignore */});
                stream.on('close', () => {
                    output = output.trim().toLowerCase();
                    let platform = 'linux';
                    let arch = 'x64';

                    if (output.includes('darwin')) { platform = 'darwin'; }
                    else if (output.includes('windows')) { platform = 'win32'; }

                    if (output.includes('arm64') || output.includes('aarch64')) { arch = 'arm64'; }
                    else if (output.includes('armv7') || output.includes('armv6')) { arch = 'armhf'; }

                    resolve({ platform, arch });
                });
            });
        });
    }

    private forwardRemotePort(client: SshClient, remotePort: number, preferredLocalPort?: number): Promise<number> {
        return new Promise((resolve, reject) => {
            // Let OS pick a free local port or use preferred
            const net = require('net');
            const server = net.createServer();
            server.listen(preferredLocalPort ?? 0, '127.0.0.1', () => {
                const localPort = (server.address() as any).port;
                server.close();

                // Use ssh2's built-in TCP forwarding
                client.forwardOut('127.0.0.1', localPort, '127.0.0.1', remotePort, (err, _stream) => {
                    if (err) {
                        // forwardOut is called per-connection; set up a local TCP server
                        // that proxies every connection through SSH port forwarding
                    }
                });

                // Create a local server that forwards each TCP connection via SSH
                const proxy = net.createServer((sock: any) => {
                    client.forwardOut('127.0.0.1', localPort, '127.0.0.1', remotePort, (err, stream) => {
                        if (err) {
                            sock.destroy();
                            return;
                        }
                        sock.pipe(stream);
                        stream.pipe(sock);
                        sock.on('error', () => stream.destroy());
                        stream.on('error', () => sock.destroy());
                    });
                });

                proxy.listen(localPort, '127.0.0.1', () => resolve(localPort));
                proxy.on('error', reject);
            });
            server.on('error', reject);
        });
    }

    private openProxyStream(proxyJump: string, targetHost: string, targetPort: number): Promise<any> {
        return new Promise((resolve, reject) => {
            // Parse proxyJump: [user@]host[:port]
            let proxyUser: string | undefined;
            let proxyHost: string;
            let proxyPort = 22;

            const withUser = proxyJump.includes('@');
            const parts = proxyJump.split('@');
            const hostPart = withUser ? parts[1] : parts[0];
            if (withUser) { proxyUser = parts[0]; }

            if (hostPart.includes(':')) {
                const [h, p] = hostPart.split(':');
                proxyHost = h;
                proxyPort = parseInt(p, 10);
            } else {
                proxyHost = hostPart;
            }

            const jumpClient = new SshClient();
            const agentSocket = process.env.SSH_AUTH_SOCK;
            const cfg: ConnectConfig = {
                host: proxyHost,
                port: proxyPort,
                username: proxyUser ?? os.userInfo().username,
                agent: agentSocket
            };

            jumpClient.on('ready', () => {
                jumpClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
                    if (err) { jumpClient.end(); reject(err); return; }
                    resolve(stream);
                });
            });
            jumpClient.on('error', reject);
            jumpClient.connect(cfg);
        });
    }

    private makeResolvedAuthority(host: string, port: number): any {
        // Return format expected by the proposed RemoteAuthorityResolver API
        return { host, port, connectionToken: undefined };
    }
}
