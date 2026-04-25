/**
 * Internal logging utility.
 * Wraps OutputChannel to provide levelled logging for the extension.
 */
import * as vscode from 'vscode';

type Level = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
const LEVELS: Level[] = ['off', 'error', 'warn', 'info', 'debug', 'trace'];

export class Logger {
    private channel: vscode.OutputChannel;
    private levelValue: number;

    constructor(channelName: string) {
        this.channel = vscode.window.createOutputChannel(channelName);
        this.levelValue = this.readLevel();

        // Re-read level whenever settings change
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sshRemote.logLevel')) {
                this.levelValue = this.readLevel();
            }
        });
    }

    error(msg: string): void { this.log('error', msg); }
    warn(msg: string): void { this.log('warn', msg); }
    info(msg: string): void { this.log('info', msg); }
    debug(msg: string): void { this.log('debug', msg); }
    trace(msg: string): void { this.log('trace', msg); }

    show(): void {
        this.channel.show(true);
    }

    private log(level: Level, msg: string): void {
        if (this.levelValue < LEVELS.indexOf(level)) { return; }
        const ts = new Date().toISOString();
        const tag = level.toUpperCase().padEnd(5);
        this.channel.appendLine(`[${ts}] [${tag}] ${msg}`);
    }

    private readLevel(): number {
        try {
            const cfg = vscode.workspace.getConfiguration('sshRemote');
            const l: Level = cfg.get('logLevel') ?? 'info';
            return LEVELS.indexOf(l);
        } catch {
            return LEVELS.indexOf('info');
        }
    }
}
