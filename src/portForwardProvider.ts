import * as vscode from 'vscode';

export interface ForwardedPort {
    localPort: number;
    remotePort: number;
    name?: string;
}

export class PortForwardProvider implements vscode.TreeDataProvider<PortItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PortItem | undefined | void> = new vscode.EventEmitter<PortItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<PortItem | undefined | void> = this._onDidChangeTreeData.event;

    private ports: ForwardedPort[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PortItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PortItem): PortItem[] {
        if (this.ports.length === 0) {
            return [new PortItem('No active port forwards', '', vscode.TreeItemCollapsibleState.None)];
        }
        return this.ports.map(p => new PortItem(`localhost:${p.localPort} → remote:${p.remotePort}`, p.name || 'Custom Tunnel', vscode.TreeItemCollapsibleState.None, p));
    }

    addPort(port: ForwardedPort) {
        this.ports.push(port);
        this.refresh();
    }

    removePort(port: ForwardedPort) {
        this.ports = this.ports.filter(p => p.localPort !== port.localPort);
        this.refresh();
    }

    getPorts() {
        return this.ports;
    }
}

export class PortItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly portData?: ForwardedPort
    ) {
        super(label, collapsibleState);
        if (portData) {
            this.contextValue = 'port';
            this.iconPath = new vscode.ThemeIcon('remote-explorer');
        }
    }
}
