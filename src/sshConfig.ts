/**
 * SSH configuration parser and manager.
 * Provides a structured interface for reading and writing standard SSH config files.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from './logger';

export interface SshHostEntry {
    Host: string;
    HostName?: string;
    User?: string;
    Port?: number;
    IdentityFile?: string;
    ProxyJump?: string;
    ProxyCommand?: string;
    ForwardAgent?: boolean;
    ServerAliveInterval?: number;
    ServerAliveCountMax?: number;
    StrictHostKeyChecking?: 'yes' | 'no' | 'accept-new';
    /** Raw remaining key=value pairs we don't explicitly parse */
    extra?: Record<string, string>;
}

export class SshConfigManager {
    private configPath: string;
    private hosts: SshHostEntry[] = [];
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
        this.configPath = this.resolveConfigPath();
        this.load();
    }

    // ─── Public API ───────────────────────────────────────────────

    getConfigPath(): string {
        return this.configPath;
    }

    getHosts(): SshHostEntry[] {
        this.load();
        return this.hosts.filter(h => h.Host !== '*');
    }

    getHost(alias: string): SshHostEntry | undefined {
        return this.hosts.find(h => h.Host === alias);
    }

    addHost(entry: SshHostEntry): void {
        this.load();
        // Remove existing entry with same alias if any
        this.hosts = this.hosts.filter(h => h.Host !== entry.Host);
        this.hosts.push(entry);
        this.save();
    }

    removeHost(alias: string): void {
        this.load();
        this.hosts = this.hosts.filter(h => h.Host !== alias);
        this.save();
    }

    updateConfigPath(newPath: string): void {
        this.configPath = newPath;
        this.load();
    }

    // ─── Internal ─────────────────────────────────────────────────

    private resolveConfigPath(): string {
        const cfgFromSettings = this.readSettingPath();
        if (cfgFromSettings) { return cfgFromSettings; }
        return path.join(os.homedir(), '.ssh', 'config');
    }

    private readSettingPath(): string | undefined {
        try {
            const vscode = require('vscode');
            const cfg = vscode.workspace.getConfiguration('sshRemote');
            const p: string = cfg.get('sshConfigPath', '');
            return p.trim() !== '' ? p : undefined;
        } catch {
            return undefined;
        }
    }

    private load(): void {
        if (!fs.existsSync(this.configPath)) {
            this.hosts = [];
            return;
        }
        try {
            const raw = fs.readFileSync(this.configPath, 'utf8');
            this.hosts = this.parse(raw);
            this.logger.debug(`Loaded ${this.hosts.length} host(s) from ${this.configPath}`);
        } catch (err) {
            this.logger.error(`Failed to read SSH config: ${err}`);
            this.hosts = [];
        }
    }

    private save(): void {
        try {
            const sshDir = path.dirname(this.configPath);
            if (!fs.existsSync(sshDir)) {
                fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
            }

            const lines: string[] = ['# Managed by Remote SSH (Open Source) – do not edit Host blocks directly\n'];
            for (const h of this.hosts) {
                lines.push(`Host ${h.Host}`);
                if (h.HostName) { lines.push(`    HostName ${h.HostName}`); }
                if (h.User) { lines.push(`    User ${h.User}`); }
                if (h.Port) { lines.push(`    Port ${h.Port}`); }
                if (h.IdentityFile) { lines.push(`    IdentityFile ${h.IdentityFile}`); }
                if (h.ProxyJump) { lines.push(`    ProxyJump ${h.ProxyJump}`); }
                if (h.ProxyCommand) { lines.push(`    ProxyCommand ${h.ProxyCommand}`); }
                if (h.ForwardAgent !== undefined) { lines.push(`    ForwardAgent ${h.ForwardAgent ? 'yes' : 'no'}`); }
                if (h.ServerAliveInterval !== undefined) { lines.push(`    ServerAliveInterval ${h.ServerAliveInterval}`); }
                if (h.ServerAliveCountMax !== undefined) { lines.push(`    ServerAliveCountMax ${h.ServerAliveCountMax}`); }
                if (h.StrictHostKeyChecking) { lines.push(`    StrictHostKeyChecking ${h.StrictHostKeyChecking}`); }
                if (h.extra) {
                    for (const [k, v] of Object.entries(h.extra)) {
                        lines.push(`    ${k} ${v}`);
                    }
                }
                lines.push('');
            }

            fs.writeFileSync(this.configPath, lines.join('\n'), { mode: 0o600, encoding: 'utf8' });
            this.logger.debug(`Saved SSH config to ${this.configPath}`);
        } catch (err) {
            this.logger.error(`Failed to write SSH config: ${err}`);
            throw err;
        }
    }

    private parse(raw: string): SshHostEntry[] {
        const entries: SshHostEntry[] = [];
        let current: SshHostEntry | null = null;

        for (const rawLine of raw.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) { continue; }

            const [keyRaw, ...rest] = line.split(/\s+/);
            const key = keyRaw.toLowerCase();
            const value = rest.join(' ');

            if (key === 'host') {
                if (current) { entries.push(current); }
                current = { Host: value };
            } else if (current) {
                switch (key) {
                    case 'hostname': current.HostName = value; break;
                    case 'user': current.User = value; break;
                    case 'port': current.Port = parseInt(value, 10); break;
                    case 'identityfile': current.IdentityFile = value; break;
                    case 'proxyjump': current.ProxyJump = value; break;
                    case 'proxycommand': current.ProxyCommand = value; break;
                    case 'forwardagent': current.ForwardAgent = value.toLowerCase() === 'yes'; break;
                    case 'serveraliveinterval': current.ServerAliveInterval = parseInt(value, 10); break;
                    case 'serveralivecountmax': current.ServerAliveCountMax = parseInt(value, 10); break;
                    case 'stricthostkeychecking':
                        current.StrictHostKeyChecking = value as 'yes' | 'no' | 'accept-new';
                        break;
                    default:
                        if (!current.extra) { current.extra = {}; }
                        current.extra[keyRaw] = value;
                }
            }
        }
        if (current) { entries.push(current); }
        return entries;
    }
}
