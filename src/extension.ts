import * as vscode from 'vscode';
import * as path from 'path';
import { envToJson, jsonToEnv } from './converter';

export function activate(context: vscode.ExtensionContext) {
  // Command: Replace current editor content (.env → JSON)
  const envToJsonCmd = vscode.commands.registerCommand('envify.envToJson', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const content = editor.document.getText();

    try {
      const json = envToJson(content);
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(content.length)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, json);
      });

      // Change language mode to JSON
      await vscode.languages.setTextDocumentLanguage(editor.document, 'json');
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

    const content = editor.document.getText();

    try {
      const env = jsonToEnv(content);
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(content.length)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, env);
      });

      // Change language mode to plaintext (closest to .env)
      await vscode.languages.setTextDocumentLanguage(editor.document, 'plaintext');
      vscode.window.showInformationMessage('Envify: Converted JSON → .env');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  // Command: Convert .env → JSON and save as new file
  const envToJsonNewFileCmd = vscode.commands.registerCommand('envify.envToJsonNewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const content = editor.document.getText();

    try {
      const json = envToJson(content);
      const currentDir = path.dirname(editor.document.uri.fsPath);
      const originalName = path.basename(editor.document.fileName);
      const newFileName = `${originalName}.json`;
      const newFilePath = path.join(currentDir, newFileName);
      const newUri = vscode.Uri.file(newFilePath);

      try {
        await vscode.workspace.fs.stat(newUri);
        const overwrite = await vscode.window.showWarningMessage(
          `"${newFileName}" already exists. Overwrite?`,
          'Overwrite', 'Cancel'
        );
        if (overwrite !== 'Overwrite') { return; }
      } catch {
        // File doesn't exist — proceed
      }

      await vscode.workspace.fs.writeFile(newUri, Buffer.from(json, 'utf8'));

      const doc = await vscode.workspace.openTextDocument(newUri);
      await vscode.window.showTextDocument(doc);

      vscode.window.showInformationMessage(`Envify: Created ${newFileName}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  // Command: Convert JSON → .env and save as new file
  const jsonToEnvNewFileCmd = vscode.commands.registerCommand('envify.jsonToEnvNewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Envify: No active editor found.');
      return;
    }

    const content = editor.document.getText();

    try {
      const env = jsonToEnv(content);
      const currentDir = path.dirname(editor.document.uri.fsPath);
      const baseName = path.basename(editor.document.fileName, '.json');
      const newFileName = `${baseName}.env`;
      const newFilePath = path.join(currentDir, newFileName);
      const newUri = vscode.Uri.file(newFilePath);

      try {
        await vscode.workspace.fs.stat(newUri);
        const overwrite = await vscode.window.showWarningMessage(
          `"${newFileName}" already exists. Overwrite?`,
          'Overwrite', 'Cancel'
        );
        if (overwrite !== 'Overwrite') { return; }
      } catch {
        // File doesn't exist — proceed
      }

      await vscode.workspace.fs.writeFile(newUri, Buffer.from(env, 'utf8'));

      const doc = await vscode.workspace.openTextDocument(newUri);
      await vscode.window.showTextDocument(doc);

      vscode.window.showInformationMessage(`Envify: Created ${newFileName}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Envify: ${err.message}`);
    }
  });

  context.subscriptions.push(envToJsonCmd, jsonToEnvCmd, envToJsonNewFileCmd, jsonToEnvNewFileCmd);
}

export function deactivate() {}
