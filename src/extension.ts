import * as vscode from 'vscode';
import { envToJson, jsonToEnv } from './converter';

export function activate(context: vscode.ExtensionContext) {
  // Command: Replace current editor content (.env → JSON)
  const envToJsonCmd = vscode.commands.registerCommand('envify.envToJson', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const content = hasSelection ? editor.document.getText(selection) : editor.document.getText();
    const range = hasSelection
      ? selection
      : new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));

    try {
      const json = envToJson(content);
      await editor.edit((editBuilder) => {
        editBuilder.replace(range, json);
      });

      // Change language mode to JSON only when converting the whole file
      if (!hasSelection) {
        await vscode.languages.setTextDocumentLanguage(editor.document, 'json');
      }
      vscode.window.showInformationMessage('Envify: Converted .env → JSON');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  // Command: Replace current editor content (JSON → .env)
  const jsonToEnvCmd = vscode.commands.registerCommand('envify.jsonToEnv', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const content = hasSelection ? editor.document.getText(selection) : editor.document.getText();
    const range = hasSelection
      ? selection
      : new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));

    try {
      const env = jsonToEnv(content);
      await editor.edit((editBuilder) => {
        editBuilder.replace(range, env);
      });

      // Change language mode to plaintext only when converting the whole file
      if (!hasSelection) {
        await vscode.languages.setTextDocumentLanguage(editor.document, 'plaintext');
      }
      vscode.window.showInformationMessage('Envify: Converted JSON → .env');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  // Command: Convert .env → JSON in new untitled tab
  const envToJsonNewFileCmd = vscode.commands.registerCommand('envify.envToJsonNewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const content = hasSelection ? editor.document.getText(selection) : editor.document.getText();

    try {
      const json = envToJson(content);
      const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Envify: Converted .env → JSON (New Tab)');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  // Command: Convert JSON → .env in new untitled tab
  const jsonToEnvNewFileCmd = vscode.commands.registerCommand('envify.jsonToEnvNewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const content = hasSelection ? editor.document.getText(selection) : editor.document.getText();

    try {
      const env = jsonToEnv(content);
      const doc = await vscode.workspace.openTextDocument({ content: env, language: 'plaintext' });
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Envify: Converted JSON → .env (New Tab)');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  context.subscriptions.push(envToJsonCmd, jsonToEnvCmd, envToJsonNewFileCmd, jsonToEnvNewFileCmd);
}

export function deactivate() {}
