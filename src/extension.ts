/**
 * Extension entry point.
 * Handles activation, command registration, and high-level component initialization.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { SshHostTreeProvider, SshHostTreeItem } from './hostTreeProvider';
import { SshConfigManager } from './sshConfig';
import { RemoteAuthorityResolverImpl } from './resolver';
import { Logger } from './logger';
import { ServerManager } from './serverManager';
import { StatusBar } from './statusBar';
import { PortForwardProvider, PortItem } from './portForwardProvider';
import { deploySshKey } from './keyDeploy';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = new Logger('Remote SSH (Open Source)');
    const statusBar = new StatusBar(context);
    statusBar.update();

    const configManager = new SshConfigManager(logger);
    const treeProvider = new SshHostTreeProvider(configManager, logger);
    
    const treeView = vscode.window.createTreeView('sshRemote.hosts', {
        treeDataProvider: treeProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    const portProvider = new PortForwardProvider();
    vscode.window.registerTreeDataProvider('sshRemote.ports', portProvider);

    const serverManager = new ServerManager(logger, context);
    const resolver = new RemoteAuthorityResolverImpl(serverManager, configManager, logger, statusBar);

    if ('registerRemoteAuthorityResolver' in vscode.workspace) {
        const disposable = (vscode.workspace as any).registerRemoteAuthorityResolver(
            'ssh-remote',
            resolver
        );
        context.subscriptions.push(disposable);
    } else {
        logger.warn(
            'vscode.workspace.registerRemoteAuthorityResolver is not available. ' +
            'Make sure "enable-proposed-api" includes "saurav-z.vsc-ssh-extension" in your argv.json.'
        );
        vscode.window.showWarningMessage(
            'Remote SSH (Open Source): Proposed API not enabled. ' +
            'Please add the extension id to "enable-proposed-api" in argv.json and restart.',
            'Open argv.json'
        ).then(choice => {
            if (choice === 'Open argv.json') {
                vscode.commands.executeCommand('workbench.action.configureRuntimeArguments');
            }
        });
    }

    // ─── Commands ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('sshRemote.connect', async (item?: SshHostTreeItem) => {
            await cmdConnect(item, configManager, logger, false);
        }),

        vscode.commands.registerCommand('sshRemote.connectInNewWindow', async (item?: SshHostTreeItem) => {
            await cmdConnect(item, configManager, logger, true);
        }),

        vscode.commands.registerCommand('sshRemote.addHost', async () => {
            await cmdAddHost(configManager, treeProvider, logger);
        }),

        vscode.commands.registerCommand('sshRemote.openConfig', async () => {
            const cfgPath = configManager.getConfigPath();
            if (!fs.existsSync(cfgPath)) {
                fs.writeFileSync(cfgPath, '# SSH Config managed by Remote SSH (Open Source)\n\n', 'utf8');
            }
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
            await vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('sshRemote.showHosts', async () => {
            await cmdConnect(undefined, configManager, logger, false);
        }),

        vscode.commands.registerCommand('sshRemote.removeHost', async (item?: SshHostTreeItem) => {
            await cmdRemoveHost(item, configManager, treeProvider, logger);
        }),

        vscode.commands.registerCommand('sshRemote.refreshHosts', () => {
            treeProvider.refresh();
        }),

        vscode.commands.registerCommand('sshRemote.openTerminal', async (item?: SshHostTreeItem) => {
            await cmdOpenTerminal(item, configManager, logger);
        }),

        vscode.commands.registerCommand('sshRemote.copyRemotePath', async () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (uri && uri.scheme === 'vscode-remote') {
                await vscode.env.clipboard.writeText(uri.path);
                vscode.window.showInformationMessage(`Copied: ${uri.path}`);
            } else {
                vscode.window.showWarningMessage('No remote file is currently open.');
            }
        }),

        vscode.commands.registerCommand('sshRemote.deployKey', async (item: SshHostTreeItem) => {
            const host = configManager.getHosts().find(h => h.Host === item.label);
            if (host) {
                await deploySshKey(host, configManager, logger);
                treeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('sshRemote.forwardPort', async () => {
            const authority = vscode.workspace.workspaceFolders?.[0]?.uri.authority;
            if (!authority || !authority.startsWith('ssh-remote+')) {
                vscode.window.showErrorMessage('You must be connected to a remote host to forward ports.');
                return;
            }
            const hostAlias = authority.replace('ssh-remote+', '');

            const port = await vscode.window.showInputBox({
                prompt: 'Remote port to forward',
                placeHolder: 'e.g. 8080, 5432'
            });
            if (!port) return;

            try {
                const localPort = await resolver.forwardPort(hostAlias, parseInt(port, 10));
                portProvider.addPort({ localPort, remotePort: parseInt(port, 10), name: 'Manual Tunnel' });
                vscode.window.showInformationMessage(`Port ${port} forwarded to localhost:${localPort}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to forward port: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('sshRemote.stopForwarding', (item: PortItem) => {
            if (item.portData) {
                portProvider.removePort(item.portData);
                // Note: The actual TCP server in the resolver remains open for the lifecycle 
                // but we hide it from the UI. Real teardown would require tracking server instances.
            }
        })
    );

    logger.info('Extension activated successfully.');
}

// ─── Command Implementations ──────────────────────────────────────────────────

async function cmdConnect(
    item: SshHostTreeItem | undefined,
    configManager: SshConfigManager,
    logger: Logger,
    newWindow: boolean
): Promise<void> {
    let hostAlias: string | undefined;

    if (item) {
        hostAlias = item.label as string;
    } else {
        const hosts = configManager.getHosts();
        const picks: vscode.QuickPickItem[] = [
            ...hosts.map(h => ({
                label: h.Host,
                description: [h.HostName, h.User ? `(${h.User})` : ''].filter(Boolean).join(' '),
                detail: h.IdentityFile ? `🔑 ${h.IdentityFile}` : ''
            })),
            { label: '$(add) Add New SSH Host…', description: 'Configure a new SSH connection' }
        ];

        const chosen = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select an SSH host to connect to',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!chosen) { return; }

        if (chosen.label.startsWith('$(add)')) {
            await cmdAddHost(configManager, undefined, logger);
            return;
        }
        hostAlias = chosen.label;
    }

    if (!hostAlias) { return; }

    // Ask for the remote folder
    const remoteFolder = await vscode.window.showInputBox({
        prompt: `Remote folder on "${hostAlias}"`,
        value: '~',
        validateInput: v => v.trim() === '' ? 'Path cannot be empty' : undefined
    });
    if (remoteFolder === undefined) { return; }

    const authority = `ssh-remote+${hostAlias}`;
    const uri = vscode.Uri.parse(`vscode-remote://${authority}${remoteFolder.startsWith('/') ? remoteFolder : `/${remoteFolder}`}`);

    logger.info(`Opening remote folder: ${uri.toString()}`);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
}

async function cmdAddHost(
    configManager: SshConfigManager,
    treeProvider: SshHostTreeProvider | undefined,
    logger: Logger
): Promise<void> {
    const hostOrUser = await vscode.window.showInputBox({
        prompt: 'Enter SSH connection details',
        placeHolder: 'user@hostname or hostname',
        validateInput: v => {
            if (!v.trim()) { return 'Cannot be empty'; }
            return undefined;
        }
    });
    if (!hostOrUser) { return; }

    let user = '';
    let hostname = hostOrUser.trim();
    if (hostname.includes('@')) {
        [user, hostname] = hostname.split('@', 2);
    }

    const port = await vscode.window.showInputBox({
        prompt: 'SSH port (leave blank for 22)',
        placeHolder: '22'
    });

    const alias = await vscode.window.showInputBox({
        prompt: 'Alias / label for this host (used in config and tree)',
        value: hostname,
        validateInput: v => !v.trim() ? 'Alias cannot be empty' : undefined
    });
    if (!alias) { return; }

    const identityFile = await vscode.window.showInputBox({
        prompt: 'Path to private key (leave blank to use password / ssh-agent)',
        placeHolder: '~/.ssh/id_rsa'
    });

    configManager.addHost({
        Host: alias.trim(),
        HostName: hostname,
        User: user || undefined,
        Port: port ? parseInt(port, 10) : undefined,
        IdentityFile: identityFile || undefined
    });

    treeProvider?.refresh();
    logger.info(`Added SSH host: ${alias}`);

    const action = await vscode.window.showInformationMessage(
        `Host "${alias}" added. Connect now?`,
        'Connect', 'Dismiss'
    );
    if (action === 'Connect') {
        await cmdConnect(undefined, configManager, logger, false);
    }
}

async function cmdRemoveHost(
    item: SshHostTreeItem | undefined,
    configManager: SshConfigManager,
    treeProvider: SshHostTreeProvider,
    logger: Logger
): Promise<void> {
    let hostAlias: string | undefined = item?.label as string;

    if (!hostAlias) {
        const hosts = configManager.getHosts();
        const pick = await vscode.window.showQuickPick(
            hosts.map(h => ({ label: h.Host })),
            { placeHolder: 'Select host to remove' }
        );
        if (!pick) { return; }
        hostAlias = pick.label;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Remove host "${hostAlias}" from SSH config?`,
        { modal: true },
        'Remove'
    );
    if (confirm !== 'Remove') { return; }

    configManager.removeHost(hostAlias);
    treeProvider.refresh();
    logger.info(`Removed SSH host: ${hostAlias}`);
}

async function cmdOpenTerminal(
    item: SshHostTreeItem | undefined,
    configManager: SshConfigManager,
    logger: Logger
): Promise<void> {
    let hostAlias: string | undefined = item?.label as string;

    if (!hostAlias) {
        const hosts = configManager.getHosts();
        const pick = await vscode.window.showQuickPick(
            hosts.map(h => ({ label: h.Host, description: h.HostName })),
            { placeHolder: 'Select host to open terminal on' }
        );
        if (!pick) { return; }
        hostAlias = pick.label;
    }

    const hostEntry = configManager.getHosts().find(h => h.Host === hostAlias);
    if (!hostEntry) {
        vscode.window.showErrorMessage(`Host "${hostAlias}" not found in SSH config.`);
        return;
    }

    const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
    const args = buildSshArgs(hostEntry);

    const terminal = vscode.window.createTerminal({
        name: `SSH: ${hostAlias}`,
        shellPath: sshBin,
        shellArgs: args,
        iconPath: new vscode.ThemeIcon('remote')
    });
    terminal.show();
    logger.info(`Opened terminal for host: ${hostAlias}`);
}

function buildSshArgs(host: import('./sshConfig').SshHostEntry): string[] {
    const args: string[] = [];
    if (host.Port) { args.push('-p', String(host.Port)); }
    if (host.IdentityFile) { args.push('-i', host.IdentityFile); }
    const destination = host.User ? `${host.User}@${host.HostName || host.Host}` : (host.HostName || host.Host);
    args.push(destination);
    return args;
}

export function deactivate(): void {
    // Cleanup is handled via context.subscriptions
}
