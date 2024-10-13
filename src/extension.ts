import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as lc from 'vscode-languageclient/node';
import { homedir } from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import type { ClangdExtension } from '@clangd/vscode-clangd';

import { Config } from './config';

const CLANGD_EXTENSION = 'llvm-vs-code-extensions.vscode-clangd';
const CLANGD_COMMAND_RESTART = 'clangd.restart';
const WAIT_TIME_TO_APPLY_MS = 1000;
const CLANGD_API_VERSION = 1;

let WAIT_TO_CHECK_WRITING = 10;

export function activate(context: vscode.ExtensionContext) {
	const clangdExtension = vscode.extensions.getExtension<ClangdExtension>(CLANGD_EXTENSION);
	if (!clangdExtension) {
		return undefined;
	}

	const hash = crypto.createHash('md5').update(context.extension.id).digest('hex');
	WAIT_TO_CHECK_WRITING = (parseInt(hash, 16) % 1000) + 10;

	const disposable = vscode.commands.registerCommand('clangd.action.showReferences',
		async (argument: {
			uri: string; position: lc.Position; locations: lc.Location[];
		}) => {
			if (!clangdExtension.isActive) {
				await clangdExtension.activate();
			}
			const api = clangdExtension.exports.getApi(CLANGD_API_VERSION);
			const client = api.languageClient;
			if (client) {
				await vscode.commands.executeCommand(
					'editor.action.showReferences',
					vscode.Uri.parse(argument.uri),
					client.protocol2CodeConverter.asPosition(argument.position),
					argument.locations.map(client.protocol2CodeConverter.asLocation),
				);
			}
		});

	context.subscriptions.push(disposable);
	context.subscriptions.push(new ConfigWatcher());
}

export function deactivate() { }

class ConfigWatcher implements vscode.Disposable {
	private static flag = '--code-lens';

	private onDocumentChanged: vscode.Disposable;
	private onConfigurationChanged: vscode.Disposable;
	private support: Map<string, boolean> = new Map();
	private clangd: string = '';
	private codelens: boolean = true;
	private changed: boolean = false;

	constructor() {
		this.onDocumentChanged = vscode.window.onDidChangeActiveTextEditor((event) => this.didDocumentChange(event?.document));
		this.onConfigurationChanged = vscode.workspace.onDidChangeConfiguration((e) => this.didConfigurationChange(e));

		Config.read().then((config) => {
			const clangd = vscode.workspace.getConfiguration('clangd');
			this.clangd = clangd.get<string>('path', '');

			this.codelens = config.Enabled;
			this.changed = true;
			ConfigWatcher.isFlagSupported(this.clangd).then((supported) => {
				this.support.set(this.clangd, supported);
				if (!supported) this.codelens = true; // Default value to remove flag

				this.write().then((changed) => {
					if (!changed || !config.RestartServerOnChange) return;

					ConfigWatcher.doRestartClangd();
				});
			});
		});
	}
	dispose() {
		this.onDocumentChanged.dispose();
		this.onConfigurationChanged.dispose();
	}

	private async didDocumentChange(document?: vscode.TextDocument) {
		const lang = document?.languageId || '';
		if (!['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp'].includes(lang)) return;
		const changed = await this.write();

		if (!changed) return;

		const config = await Config.read();
		if (!config.RestartServerOnChange) return;

		ConfigWatcher.doRestartClangd();
	}
	private async didConfigurationChange(e: vscode.ConfigurationChangeEvent) {
		const changedClangdPath = e.affectsConfiguration('clangd.path');
		const changedClangdArgs = e.affectsConfiguration('clangd.arguments');
		const changedCodeLens = e.affectsConfiguration('clangd.CodeLens.Enabled');
		if (!changedClangdPath && !changedClangdArgs && !changedCodeLens) return;

		if (changedClangdPath)
			this.clangd = vscode.workspace.getConfiguration('clangd').get<string>('path', '');

		let config = await Config.read();
		if (changedCodeLens)
			this.codelens = config.Enabled;
		this.changed = true;

		if (this.support.has(this.clangd)) {
			if (!this.support.get(this.clangd))
				this.codelens = true; // Default value to remove flag
		} else {
			const supported = await ConfigWatcher.isFlagSupported(this.clangd);
			this.support.set(this.clangd, supported);
			if (!supported) this.codelens = true; // Default value to remove flag
		}
	}

	private static doRestartClangd() {
		const clangdExtension = vscode.extensions.getExtension(CLANGD_EXTENSION);
		if (!clangdExtension || !clangdExtension.isActive) return;

		setTimeout(function () {
			vscode.commands.executeCommand(CLANGD_COMMAND_RESTART);
		}, WAIT_TIME_TO_APPLY_MS);
	}

	private async write(): Promise<boolean> {
		if (!this.changed) return false;
		this.changed = false;

		let config = vscode.workspace.getConfiguration("clangd");
		const args = config.get<string[]>('arguments', []);

		const arg = ConfigWatcher.flag + '=' + (this.codelens ? '1' : '0');
		const argId = args.findIndex(arg => arg.trimStart().startsWith(ConfigWatcher.flag));
		if (argId >= 0) {
			let curValue = args[argId].trimStart().substring(ConfigWatcher.flag.length).trim();
			if (curValue.startsWith('=')) curValue = curValue.substring(1).trim().toLowerCase();
			else if (curValue.length === 0) curValue = '1';

			const codelens = curValue === '1' || curValue === 'true';

			if (codelens === this.codelens && !this.codelens)
				return false;

			if (!this.codelens)
				args[argId] = arg;
			else
				args.splice(argId, 1);
		} else if (!this.codelens)
			args.push(arg);

		await config.update('arguments', args, vscode.ConfigurationTarget.Workspace);
		await ConfigWatcher.sleep(WAIT_TO_CHECK_WRITING);
		if (!ConfigWatcher.isEqual(args, vscode.workspace.getConfiguration("clangd").get<string[]>('arguments', []))) {
			this.changed = true;
			return this.write();
		}
		return true;
	}

	private static isEqual(lhs: string[], rhs: string[]): boolean {
		if (lhs.length !== rhs.length)
			return false;

		for (const arg of lhs) {
			if (rhs.indexOf(arg) === -1)
				return false;
		}
		return true;
	}

	private static async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private static async isFlagSupported(clangd: string): Promise<boolean> {
		if (clangd === '') clangd = 'clangd';
		else clangd = substitute(clangd);

		const execAsync = promisify(exec);
		const { stdout, stderr } = await execAsync(`${clangd} --help-hidden`);
		return stdout.includes(ConfigWatcher.flag);
	}
};

/* -------------------------------------------------------------------------- */
/*                        From vscode-clamgd extension                        */
/* -------------------------------------------------------------------------- */

// Traverse a JSON value, replacing placeholders in all strings.
function substitute<T>(val: T): T {
	if (typeof val === 'string') {
		val = val.replace(/\$\{(.*?)\}/g, (match, name) => {
			// If there's no replacement available, keep the placeholder.
			return replacement(name) ?? match;
		}) as unknown as T;
	} else if (Array.isArray(val))
		val = val.map((x) => substitute(x)) as unknown as T;
	return val;
}

// Subset of substitution variables that are most likely to be useful.
// https://code.visualstudio.com/docs/editor/variables-reference
function replacement(name: string): string | undefined {
	if (name === 'userHome') {
		return homedir();
	}
	if (name === 'workspaceRoot' || name === 'workspaceFolder' ||
		name === 'cwd') {
		if (vscode.workspace.rootPath !== undefined)
			return vscode.workspace.rootPath;
		if (vscode.window.activeTextEditor !== undefined)
			return path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
		return process.cwd();
	}
	if (name === 'workspaceFolderBasename' &&
		vscode.workspace.rootPath !== undefined) {
		return path.basename(vscode.workspace.rootPath);
	}
	const envPrefix = 'env:';
	if (name.startsWith(envPrefix))
		return process.env[name.substr(envPrefix.length)] ?? '';
	const configPrefix = 'config:';
	if (name.startsWith(configPrefix)) {
		const config = vscode.workspace.getConfiguration().get(
			name.substr(configPrefix.length));
		return (typeof config === 'string') ? config : undefined;
	}

	return undefined;
}
