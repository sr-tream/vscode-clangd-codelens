import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/node';

import type { ClangdApiV1, ClangdExtension } from '@clangd/vscode-clangd';

const CLANGD_EXTENSION = 'llvm-vs-code-extensions.vscode-clangd';
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
}

export function deactivate() { }
