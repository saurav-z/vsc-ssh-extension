/**
 * Remote server lifecycle manager.
 * Handles detection, installation, and execution of the server binary on the remote host.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Client as SshClient } from 'ssh2';
import { Logger } from './logger';

const EDITOR_COMMIT = (vscode as any).env?.appRoot
    ? (() => {
        try {
            const pkgPath = path.join((vscode as any).env.appRoot, '..', 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return pkg.commit as string | undefined;
        } catch { return undefined; }
    })()
    : undefined;

export class ServerManager {
    constructor(
        private readonly logger: Logger,
        private readonly context: vscode.ExtensionContext
    ) {}

    /**
     * Ensures the server is running on the remote machine and returns
     * the port it is listening on.
     */
    async ensureServerOnRemote(
        client: SshClient,
        platform: string,
        arch: string
    ): Promise<number> {
        const installPath = this.getInstallPath();
        const serverBin = platform === 'win32'
            ? `${installPath}/bin/code-server.cmd`
            : `${installPath}/bin/code-server`;

        this.logger.info(`Checking for server at: ${serverBin}`);

        const installed = await this.execRemote(client, `test -f "${serverBin}" && echo yes || echo no`);
        const versionMatch = await this.checkVersionMatch(client, serverBin, platform);

        if (installed.trim() !== 'yes' || !versionMatch) {
            this.logger.info('Server not found or version mismatch — installing…');
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Remote SSH (Open Source): Installing remote server…',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Downloading server binary…', increment: 10 });
                    await this.installServer(client, platform, arch, installPath, progress);
                }
            );
        } else {
            this.logger.info('Remote server already installed and up to date.');
        }

        return await this.startServer(client, serverBin, platform);
    }

    // ─── Private ──────────────────────────────────────────────────

    private getInstallPath(): string {
        const settings = vscode.workspace.getConfiguration('sshRemote');
        const installPath = settings.get<string>('serverInstallPath') || '~/.code-server';
        return installPath;
    }

    private async checkVersionMatch(client: SshClient, serverBin: string, platform: string): Promise<boolean> {
        if (!EDITOR_COMMIT) { return true; } // Can't verify, assume OK
        try {
            const out = await this.execRemote(
                client,
                platform === 'win32'
                    ? `${serverBin} --version 2>nul`
                    : `${serverBin} --version 2>/dev/null`
            );
            return out.includes(EDITOR_COMMIT);
        } catch {
            return false;
        }
    }

    private async installServer(
        client: SshClient,
        platform: string,
        arch: string,
        installPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        // Build the download URL for the VSCode Server OSS build
        const platformId = this.getPlatformId(platform, arch);
        const commit = EDITOR_COMMIT ?? 'stable';
        const downloadUrl = `https://update.code.visualstudio.com/commit:${commit}/server-${platformId}/stable`;

        this.logger.info(`Server download URL: ${downloadUrl}`);

        // Download to a temp file on the remote using curl / wget
        const tmpTar = `/tmp/vsc-remote-oss-${Date.now()}.tar.gz`;

        const downloadCmd = [
            `mkdir -p "${installPath}"`,
            `curl -fsSL "${downloadUrl}" -o "${tmpTar}" 2>&1`,
            `|| wget -qO "${tmpTar}" "${downloadUrl}" 2>&1`
        ].join(' && ');

        progress.report({ message: 'Downloading…', increment: 30 });
        const dlOut = await this.execRemote(client, downloadCmd, 120_000);
        this.logger.debug(`Download output: ${dlOut}`);

        progress.report({ message: 'Extracting…', increment: 40 });
        const extractCmd = `tar -xzf "${tmpTar}" -C "${installPath}" --strip-components=1 && rm -f "${tmpTar}"`;
        await this.execRemote(client, extractCmd, 60_000);

        progress.report({ message: 'Setting permissions…', increment: 15 });
        await this.execRemote(client, `chmod +x "${installPath}/bin/code-server" 2>/dev/null || true`);

        progress.report({ message: 'Done.', increment: 5 });
        this.logger.info('Remote server installed successfully.');
    }

    private async startServer(
        client: SshClient,
        serverBin: string,
        platform: string
    ): Promise<number> {
        const useSocket = vscode.workspace
            .getConfiguration('sshRemote')
            .get<boolean>('remoteServerListenOnSocket') ?? false;

        // The server prints "Extension host agent listening on <port>" or similar
        const portToken = 'Extension host agent listening on';

        const startCmd = useSocket
            ? `${serverBin} --socket-path /tmp/vsc-remote-oss.sock --start-server --disable-telemetry 2>&1`
            : `${serverBin} --port 0 --start-server --disable-telemetry 2>&1`;

        this.logger.info(`Starting remote server: ${startCmd}`);

        return new Promise((resolve, reject) => {
            client.exec(startCmd, (err, stream) => {
                if (err) { reject(err); return; }

                let buffer = '';
                let portResolved = false;
                const timeout = setTimeout(() => {
                    if (!portResolved) {
                        reject(new Error('Timed out waiting for remote server to start.'));
                    }
                }, 30_000);

                stream.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    this.logger.debug(`[server] ${chunk.toString().trim()}`);

                    // Try to parse the port from output
                    const match = buffer.match(/listening on (?:port )?(\d+)/i)
                        || buffer.match(/"port"\s*:\s*(\d+)/i)
                        || buffer.match(/:\s*(\d{4,5})\s*$/m);

                    if (match && !portResolved) {
                        portResolved = true;
                        clearTimeout(timeout);
                        resolve(parseInt(match[1], 10));
                    }
                });

                stream.stderr.on('data', (chunk: Buffer) => {
                    const text = chunk.toString();
                    this.logger.debug(`[server-err] ${text.trim()}`);
                    buffer += text;
                });

                stream.on('close', (code: number) => {
                    clearTimeout(timeout);
                    if (!portResolved) {
                        reject(new Error(`Remote server exited with code ${code} before reporting port.`));
                    }
                });
            });
        });
    }

    private getPlatformId(platform: string, arch: string): string {
        if (platform === 'darwin') {
            return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        }
        if (platform === 'win32') {
            return arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
        }
        // Linux
        switch (arch) {
            case 'arm64': return 'linux-arm64';
            case 'armhf': return 'linux-armhf';
            default: return 'linux-x64';
        }
    }

    private execRemote(client: SshClient, cmd: string, timeoutMs = 30_000): Promise<string> {
        return new Promise((resolve, reject) => {
            client.exec(cmd, (err, stream) => {
                if (err) { reject(err); return; }
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => {
                    stream.destroy();
                    reject(new Error(`Remote command timed out: ${cmd}`));
                }, timeoutMs);

                stream.on('data', (d: Buffer) => (stdout += d.toString()));
                stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
                stream.on('close', (code: number) => {
                    clearTimeout(timer);
                    if (code !== 0 && !stdout) {
                        reject(new Error(`Command failed (exit ${code}): ${stderr || cmd}`));
                    } else {
                        resolve(stdout);
                    }
                });
            });
        });
    }
}
