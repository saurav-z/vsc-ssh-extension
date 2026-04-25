/**
 * Status bar management.
 * Updates the editor's status bar with the current connection state.
 */
import * as vscode from 'vscode';

export class StatusBar {
    private readonly item: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        // Priority 100 places it near the leftmost position, matching Remote-SSH behaviour
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'sshRemote.connect';
        context.subscriptions.push(this.item);
    }

    update(): void {
        // Detect if we are currently inside a remote workspace
        const authority = vscode.workspace.workspaceFolders?.[0]?.uri?.authority ?? '';
        if (authority.startsWith('ssh-remote+')) {
            const host = authority.replace('ssh-remote+', '');
            this.setConnected(host);
        } else {
            this.setIdle();
        }
    }

    setIdle(): void {
        this.item.text = '$(remote) Remote SSH';
        this.item.tooltip = 'Connect to a remote host via SSH';
        this.item.color = undefined;
        this.item.backgroundColor = undefined;
        this.item.show();
    }

    setConnecting(host: string): void {
        this.item.text = `$(loading~spin) SSH: Connecting to ${host}…`;
        this.item.tooltip = `Establishing SSH connection to ${host}`;
        this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.show();
    }

    setConnected(host: string): void {
        this.item.text = `$(remote) SSH: ${host}`;
        this.item.tooltip = `Connected to ${host} via SSH — click to switch host`;
        this.item.color = undefined;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
        this.item.show();
    }

    setDisconnected(): void {
        this.item.text = '$(remote-explorer) SSH: Disconnected';
        this.item.tooltip = 'Remote connection lost';
        this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.show();
    }

    setError(host: string): void {
        this.item.text = `$(error) SSH: ${host} (failed)`;
        this.item.tooltip = `Failed to connect to ${host}`;
        this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.show();
    }
}
