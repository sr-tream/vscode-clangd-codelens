import * as vscode from 'vscode';

export namespace Config {
    export interface CodeLens {
        RestartServerOnChange: boolean;
        Enabled: boolean;
    };
    export const DEFAULT_CONFIG: CodeLens = {
        RestartServerOnChange: false,
        Enabled: true
    }

    export async function read(): Promise<CodeLens> {
        let config = vscode.workspace.getConfiguration("clangd");
        return config.get<CodeLens>("CodeLens", DEFAULT_CONFIG);
    }

    export async function toggle(enabled: boolean) {
        let config = vscode.workspace.getConfiguration("clangd.CodeLens");
        config.update("Enabled", enabled, vscode.ConfigurationTarget.Workspace);
    }
}