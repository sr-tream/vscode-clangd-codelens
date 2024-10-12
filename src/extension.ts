import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/node';

import type { ClangdExtension } from '@clangd/vscode-clangd';

import { Config } from './config';

const CLANGD_EXTENSION = 'llvm-vs-code-extensions.vscode-clangd';
const CLANGD_COMMAND_RESTART = 'clangd.restart';
const WAIT_TIME_TO_APPLY_MS = 1000;
const CLANGD_API_VERSION = 1;

export function activate(context: vscode.ExtensionContext) {
	const clangdExtension = vscode.extensions.getExtension<ClangdExtension>(CLANGD_EXTENSION);
	if (!clangdExtension) {
		return undefined;
	}

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
	private codelens: boolean = true;

	constructor() {
		this.onDocumentChanged = vscode.workspace.onDidChangeTextDocument((event) => this.didDocumentChange(event.document));
		this.onConfigurationChanged = vscode.workspace.onDidChangeConfiguration((e) => this.didConfigurationChange(e));

		Config.read().then((config) => {
			this.codelens = config.Enabled;
			this.write().then((changed) => {
				if (!changed || !config.RestartServerOnChange) return;

				ConfigWatcher.doRestartClangd();
			});
		});
	}
	dispose() {
		this.onDocumentChanged.dispose();
		this.onConfigurationChanged.dispose();
	}

	private async didDocumentChange(document: vscode.TextDocument) {
		if (!['c', 'c++', 'cuda-cpp', 'objective-c', 'objective-cpp'].includes(document.languageId)) return;
		const changed = await this.write();

		if (!changed) return;

		const config = await Config.read();
		if (!config.RestartServerOnChange) return;

		ConfigWatcher.doRestartClangd();
	}
	private async didConfigurationChange(e: vscode.ConfigurationChangeEvent) {
		const changedClangdArgs = e.affectsConfiguration('clangd.arguments');
		const changedCodeLens = e.affectsConfiguration('clangd.CodeLens.Enabled');
		if (!changedClangdArgs && !changedCodeLens) return;

		let config = await Config.read();
		if (changedCodeLens) {
			this.codelens = config.Enabled;
			console.log(`[CodeLens] Enabled: ${this.codelens}`);
		}

		const changed = await this.write();

		if (changed) {
			if (changedClangdArgs) {
				const message = '[CodeLens] The `--code-lens` flag controlled by this extension.';
				const actionToggle = (this.codelens ? 'Disable' : 'Enable') + ' code lens';
				vscode.window.showInformationMessage(message, actionToggle).then((selection) => {
					if (selection === actionToggle)
						Config.toggle(!this.codelens);
				});
			}
			if (config.RestartServerOnChange)
				ConfigWatcher.doRestartClangd();
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
		let config = vscode.workspace.getConfiguration("clangd");
		const args = config.get<string[]>('arguments', []);
		console.log(`[CodeLens] Load clangd arguments: ${args.toString()}`);

		const arg = ConfigWatcher.flag + '=' + (this.codelens ? '1' : '0');
		const argId = args.findIndex(arg => arg.trimStart().startsWith(ConfigWatcher.flag));
		if (argId >= 0) {
			let curValue = args[argId].trimStart().substring(ConfigWatcher.flag.length).trim();
			if (curValue.startsWith('=')) curValue = curValue.substring(1).trim().toLowerCase();
			else if (curValue.length === 0) curValue = '1';

			const codelens = curValue === '1' || curValue === 'true';
			console.log(`[CodeLens] Load current codelens state: ${codelens}`);

			if (codelens === this.codelens) {
				console.log(`[CodeLens] Current state is equals`);
				return false;
			}

			args[argId] = arg;
		} else
			args.push(arg);

		await config.update('arguments', args, vscode.ConfigurationTarget.Workspace);
		console.log(`[CodeLens] Save clangd arguments: ${args.toString()}`);
		return true;
	}
};
