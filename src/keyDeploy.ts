import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client as SshClient } from 'ssh2';
import { Logger } from './logger';
import { SshHostEntry, SshConfigManager } from './sshConfig';

export async function deploySshKey(host: SshHostEntry, configManager: SshConfigManager, logger: Logger) {
    const pubKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa.pub');
    const privKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');

    // 1. Check if local key exists, if not generate it
    if (!fs.existsSync(pubKeyPath)) {
        const action = await vscode.window.showInformationMessage('No local SSH key found. Generate one now?', 'Generate', 'Cancel');
        if (action !== 'Generate') return;

        try {
            const { execSync } = require('child_process');
            if (!fs.existsSync(path.dirname(pubKeyPath))) {
                fs.mkdirSync(path.dirname(pubKeyPath), { recursive: true, mode: 0o700 });
            }
            execSync(`ssh-keygen -t rsa -b 4096 -f "${privKeyPath}" -N ""`, { stdio: 'inherit' });
            logger.info('Generated new SSH key pair.');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to generate SSH key: ${err}`);
            return;
        }
    }

    const pubKey = fs.readFileSync(pubKeyPath, 'utf8').trim();

    // 2. Connect to remote using password
    const password = await vscode.window.showInputBox({
        prompt: `Enter password for ${host.User || os.userInfo().username}@${host.HostName || host.Host} to deploy key`,
        password: true
    });
    if (password === undefined) return;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deploying SSH key to ${host.Host}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new SshClient();
                client.on('ready', () => {
                    const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
                    client.exec(cmd, (err, stream) => {
                        if (err) {
                            client.end();
                            return reject(err);
                        }
                        stream.on('close', () => {
                            client.end();
                            resolve();
                        });
                    });
                }).on('error', (err) => {
                    reject(err);
                }).connect({
                    host: host.HostName || host.Host,
                    port: host.Port || 22,
                    username: host.User || os.userInfo().username,
                    password: password
                });
            });
        });

        // 4. Update local SSH config
        host.IdentityFile = privKeyPath;
        configManager.addHost(host);
        
        vscode.window.showInformationMessage(`SSH key successfully deployed to ${host.Host}. You can now connect without a password!`);
        logger.info(`Deployed SSH key to ${host.Host}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to deploy key: ${err.message}`);
        logger.error(`Key deploy error: ${err.message}`);
    }
}
