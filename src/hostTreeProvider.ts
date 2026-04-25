/**
 * TreeDataProvider for the SSH targets view.
 * Populates the Activity Bar sidebar with hosts from the SSH config.
 */
import * as vscode from 'vscode';
import { SshConfigManager, SshHostEntry } from './sshConfig';
import { Logger } from './logger';

export class SshHostTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly hostEntry: SshHostEntry,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(label, collapsibleState);
        this.contextValue = 'host';
        this.iconPath = new vscode.ThemeIcon('remote');

        // Build description: user@hostname:port
        const parts: string[] = [];
        if (hostEntry.User) { parts.push(hostEntry.User + '@'); }
        parts.push(hostEntry.HostName ?? hostEntry.Host);
        if (hostEntry.Port && hostEntry.Port !== 22) { parts.push(`:${hostEntry.Port}`); }
        this.description = parts.join('');

        // Tooltip with full details
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${label}**\n\n`);
        if (hostEntry.HostName) { md.appendMarkdown(`- **Host**: \`${hostEntry.HostName}\`\n`); }
        if (hostEntry.User) { md.appendMarkdown(`- **User**: \`${hostEntry.User}\`\n`); }
        if (hostEntry.Port) { md.appendMarkdown(`- **Port**: \`${hostEntry.Port}\`\n`); }
        if (hostEntry.IdentityFile) { md.appendMarkdown(`- **Key**: \`${hostEntry.IdentityFile}\`\n`); }
        if (hostEntry.ProxyJump) { md.appendMarkdown(`- **ProxyJump**: \`${hostEntry.ProxyJump}\`\n`); }
        this.tooltip = md;

        // Clicking the item triggers the connect command
        this.command = {
            command: 'sshRemote.connect',
            title: 'Connect',
            arguments: [this]
        };
    }
}

export class SshHostTreeProvider implements vscode.TreeDataProvider<SshHostTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SshHostTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Track which hosts are currently connected
    private connectedHosts = new Set<string>();

    constructor(
        private readonly configManager: SshConfigManager,
        private readonly logger: Logger
    ) {
        // Watch for SSH config file changes and auto-refresh
        this.watchConfigFile();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    markConnected(alias: string): void {
        this.connectedHosts.add(alias);
        this._onDidChangeTreeData.fire();
    }

    markDisconnected(alias: string): void {
        this.connectedHosts.delete(alias);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SshHostTreeItem): vscode.TreeItem {
        // Update icon based on connection state
        if (this.connectedHosts.has(element.label as string)) {
            element.iconPath = new vscode.ThemeIcon('vm-running', new vscode.ThemeColor('charts.green'));
        }
        return element;
    }

    async getChildren(element?: SshHostTreeItem): Promise<SshHostTreeItem[]> {
        if (element) { return []; } // No children — flat list

        const hosts = this.configManager.getHosts();
        this.logger.debug(`Tree showing ${hosts.length} host(s)`);

        if (hosts.length === 0) {
            const empty = new vscode.TreeItem('No SSH hosts configured');
            empty.description = 'Click + to add a host';
            empty.iconPath = new vscode.ThemeIcon('info');
            return [empty as unknown as SshHostTreeItem];
        }

        return hosts.map(h => new SshHostTreeItem(h.Host, h));
    }

    private watchConfigFile(): void {
        const cfgPath = this.configManager.getConfigPath();
        const { watch } = require('fs');
        try {
            const watcher = watch(cfgPath, () => {
                this.logger.debug('SSH config changed — refreshing tree.');
                this.refresh();
            });
            // Keep reference to avoid GC
            (this as any)._configWatcher = watcher;
        } catch {
            // File may not exist yet; that's fine
        }
    }
}
