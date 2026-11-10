import * as vscode from 'vscode';
import {
  compareEnv,
  createResolver,
  diffEnv,
  envToDockerCompose,
  envToExample,
  envToJson,
  envToKubernetesConfigMap,
  envToKubernetesSecret,
  envToShell,
  envToYaml,
  formatEnv,
  jsonToEnv,
  lintEnv,
  normalizeEnv,
  parseEnvDocument,
  pastedJsonToEnv,
  referenceCompletionAt,
  EnvIssue,
  EnvOutputFormat,
  EnvToJsonOptions,
  JsonToEnvOptions,
  KEY_PATTERN,
} from './converter';

const DOTENV_LANGUAGE = 'dotenv';
const DIAGNOSTIC_SOURCE = 'envify';
const ENV_FILENAME_PATTERN = /(^|[\\/])(\.env(\..*)?|.*\.env)$/;
const NORMALIZED_SCHEME = 'envify-normalized';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface EnvifyConfig {
  jsonOptions: EnvToJsonOptions;
  envOptions: JsonToEnvOptions;
  expandVariables: boolean;
  exampleFileName: string;
  examplePlaceholder: string;
  diagnosticsEnabled: boolean;
  compareWithExample: boolean;
  codeLensEnabled: boolean;
  showNotifications: boolean;
  suggestConvertOnPaste: boolean;
}

function getConfig(scope?: vscode.ConfigurationScope): EnvifyConfig {
  const cfg = vscode.workspace.getConfiguration('envify', scope);
  const nestedSeparator = cfg.get<string>('nestedSeparator', '');
  const expandVariables = cfg.get<boolean>('expandVariables', false);
  return {
    jsonOptions: {
      indent: cfg.get<number>('json.indent', 2),
      inferTypes: cfg.get<boolean>('json.inferTypes', false),
      sortKeys: cfg.get<boolean>('json.sortKeys', false),
      nestedSeparator,
      expandVariables,
    },
    envOptions: {
      quoteStyle: cfg.get<'auto' | 'always'>('env.quoteStyle', 'auto'),
      sortKeys: cfg.get<boolean>('env.sortKeys', false),
      nestedSeparator,
    },
    expandVariables,
    exampleFileName: cfg.get<string>('example.fileName', '.env.example'),
    examplePlaceholder: cfg.get<string>('example.placeholder', ''),
    diagnosticsEnabled: cfg.get<boolean>('diagnostics.enabled', true),
    compareWithExample: cfg.get<boolean>('diagnostics.compareWithExample', true),
    codeLensEnabled: cfg.get<boolean>('codeLens.enabled', true),
    showNotifications: cfg.get<boolean>('showNotifications', true),
    suggestConvertOnPaste: cfg.get<boolean>('suggestConvertOnPaste', true),
  };
}

function notify(message: string): void {
  if (getConfig().showNotifications) {
    vscode.window.showInformationMessage(`Envify: ${message}`);
  }
}

function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Envify: ${message}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnvDocument(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme === 'output' || doc.uri.scheme === 'git' || doc.uri.scheme === NORMALIZED_SCHEME) {
    return false;
  }
  return doc.languageId === DOTENV_LANGUAGE || ENV_FILENAME_PATTERN.test(doc.uri.path);
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? '';
}

function siblingUri(uri: vscode.Uri, fileName: string): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..', fileName);
}

function isExampleDocument(doc: vscode.TextDocument): boolean {
  return basename(doc.uri) === getConfig(doc).exampleFileName;
}

async function readFileText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Text of the current selection, or the whole document when nothing is selected. */
function getSource(editor: vscode.TextEditor): { content: string; range: vscode.Range; hasSelection: boolean } {
  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;
  const document = editor.document;
  const content = hasSelection ? document.getText(selection) : document.getText();
  const range = hasSelection
    ? new vscode.Range(selection.start, selection.end)
    : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  return { content, range, hasSelection };
}

function requireEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Envify: No active editor found.');
  }
  return editor;
}

/** Resolve the document a command should act on: an explorer URI, or the active editor. */
async function resolveDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  if (uri instanceof vscode.Uri) {
    return vscode.workspace.openTextDocument(uri);
  }
  return requireEditor()?.document;
}

async function openInNewTab(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc);
}

function skippedLinesMessage(content: string): string {
  const invalid = lintEnv(content).filter((i) => i.code === 'invalid-line');
  if (invalid.length === 0) {
    return '';
  }
  const lines = invalid.map((i) => i.line + 1).join(', ');
  return ` (${invalid.length} invalid line${invalid.length > 1 ? 's' : ''} skipped: ${lines})`;
}

// ---------------------------------------------------------------------------
// Conversion commands
// ---------------------------------------------------------------------------

/** True during our own in-place edit, so .env → JSON output is not mistaken for pasted JSON. */
let convertingInPlace = false;

async function convertInPlace(direction: 'envToJson' | 'jsonToEnv'): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const { content, range, hasSelection } = getSource(editor);
  const config = getConfig(editor.document);

  try {
    const isEnvToJson = direction === 'envToJson';
    const output = isEnvToJson
      ? envToJson(content, config.jsonOptions)
      : jsonToEnv(content, config.envOptions);

    convertingInPlace = true;
    try {
      await editor.edit((edit) => edit.replace(range, output));
    } finally {
      convertingInPlace = false;
    }

    if (!hasSelection) {
      await vscode.languages.setTextDocumentLanguage(editor.document, isEnvToJson ? 'json' : DOTENV_LANGUAGE);
    }

    const skipped = isEnvToJson ? skippedLinesMessage(content) : '';
    if (skipped) {
      vscode.window.showWarningMessage(`Envify: Converted .env → JSON${skipped}`);
    } else {
      notify(isEnvToJson ? 'Converted .env → JSON' : 'Converted JSON → .env');
    }
  } catch (err) {
    fail(err);
  }
}

async function convertToNewTab(direction: 'envToJson' | 'jsonToEnv'): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const { content } = getSource(editor);
  const config = getConfig(editor.document);

  try {
    if (direction === 'envToJson') {
      await openInNewTab(envToJson(content, config.jsonOptions), 'json');
      const skipped = skippedLinesMessage(content);
      if (skipped) {
        vscode.window.showWarningMessage(`Envify: Converted .env → JSON (New Tab)${skipped}`);
      } else {
        notify('Converted .env → JSON (New Tab)');
      }
    } else {
      await openInNewTab(jsonToEnv(content, config.envOptions), DOTENV_LANGUAGE);
      notify('Converted JSON → .env (New Tab)');
    }
  } catch (err) {
    fail(err);
  }
}

async function copyAs(direction: 'envToJson' | 'jsonToEnv'): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const { content } = getSource(editor);
  const config = getConfig(editor.document);
  try {
    const output = direction === 'envToJson'
      ? envToJson(content, config.jsonOptions)
      : jsonToEnv(content, config.envOptions);
    await vscode.env.clipboard.writeText(output);
    notify(direction === 'envToJson' ? 'Copied as JSON' : 'Copied as .env');
  } catch (err) {
    fail(err);
  }
}

/** Offers to convert a JSON object that was just pasted on its own lines of a .env file. */
async function suggestConvertPastedJson(e: vscode.TextDocumentChangeEvent): Promise<void> {
  const doc = e.document;
  // e.reason is only set for undo/redo: undoing a conversion must not ask again.
  if (convertingInPlace || e.reason || e.contentChanges.length !== 1 || doc !== vscode.window.activeTextEditor?.document) {
    return;
  }
  const config = getConfig(doc);
  if (!config.suggestConvertOnPaste || doc.languageId === 'json' || !isEnvDocument(doc)) {
    return;
  }
  const change = e.contentChanges[0];
  const output = pastedJsonToEnv(change.text, config.envOptions);
  if (output === undefined) {
    return;
  }

  // Replace only the JSON itself: a trailing newline must survive or the next line would join the output.
  const json = change.text.trim();
  const start = change.rangeOffset + change.text.indexOf(json);
  const range = new vscode.Range(doc.positionAt(start), doc.positionAt(start + json.length));
  // `KEY=` + paste is a JSON value, not a file of settings.
  const before = doc.lineAt(range.start.line).text.slice(0, range.start.character);
  const after = doc.lineAt(range.end.line).text.slice(range.end.character);
  if (before.trim() || after.trim()) {
    return;
  }

  const convert = 'Convert';
  const choice = await vscode.window.showInformationMessage('Envify: Pasted JSON detected. Convert it to .env format?', convert);
  if (choice !== convert) {
    return;
  }
  // The notification can stay open while the user keeps editing.
  if (doc.isClosed || doc.getText(range) !== json) {
    vscode.window.showWarningMessage('Envify: The pasted JSON has changed. Use Convert JSON to .env on a selection instead.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, range, output);
  if (await vscode.workspace.applyEdit(edit)) {
    notify('Converted JSON → .env');
  }
}

interface FormatChoice extends vscode.QuickPickItem {
  format: EnvOutputFormat;
  language: string;
}

const FORMAT_CHOICES: FormatChoice[] = [
  { format: 'json', label: 'JSON', description: 'Flat or nested object', language: 'json' },
  { format: 'yaml', label: 'YAML', description: 'Flat mapping', language: 'yaml' },
  { format: 'shell', label: 'Shell script', description: "export KEY='value' lines", language: 'shellscript' },
  { format: 'docker-compose', label: 'docker-compose environment', description: 'environment: block for a service', language: 'yaml' },
  { format: 'k8s-configmap', label: 'Kubernetes ConfigMap', description: 'apiVersion v1, data as strings', language: 'yaml' },
  { format: 'k8s-secret', label: 'Kubernetes Secret', description: 'Opaque secret, base64 data', language: 'yaml' },
  { format: 'example', label: '.env.example', description: 'Same keys and comments, values blanked', language: DOTENV_LANGUAGE },
];

async function convertToFormat(): Promise<void> {
  const editor = requireEditor();
  if (!editor) {
    return;
  }
  const choice = await vscode.window.showQuickPick(FORMAT_CHOICES, {
    placeHolder: 'Convert .env to…',
    matchOnDescription: true,
  });
  if (!choice) {
    return;
  }

  const { content } = getSource(editor);
  const config = getConfig(editor.document);
  const expand = { expandVariables: config.expandVariables };

  try {
    let output: string;
    switch (choice.format) {
      case 'json':
        output = envToJson(content, config.jsonOptions);
        break;
      case 'yaml':
        output = envToYaml(content, expand);
        break;
      case 'shell':
        output = envToShell(content, expand);
        break;
      case 'docker-compose':
        output = envToDockerCompose(content, expand);
        break;
      case 'k8s-configmap':
      case 'k8s-secret': {
        const isSecret = choice.format === 'k8s-secret';
        const name = await vscode.window.showInputBox({
          prompt: `metadata.name for the ${isSecret ? 'Secret' : 'ConfigMap'}`,
          value: isSecret ? 'app-secret' : 'app-config',
          validateInput: (v) =>
            /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(v) ? undefined : 'Must be a valid DNS subdomain name (lowercase letters, digits, "-" and ".")',
        });
        if (name === undefined) {
          return;
        }
        output = isSecret
          ? envToKubernetesSecret(content, { name, ...expand })
          : envToKubernetesConfigMap(content, { name, ...expand });
        break;
      }
      case 'example':
        output = envToExample(content, { placeholder: config.examplePlaceholder });
        break;
    }
    await openInNewTab(output, choice.language);
    notify(`Converted .env → ${choice.label} (New Tab)`);
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fullRange(doc: vscode.TextDocument): vscode.Range {
  return new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
}

function formatEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
  const text = doc.getText();
  const formatted = formatEnv(text);
  return formatted === text ? [] : [vscode.TextEdit.replace(fullRange(doc), formatted)];
}

async function formatCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const edits = formatEdits(editor.document);
  if (edits.length === 0) {
    return;
  }
  await editor.edit((edit) => edit.replace(edits[0].range, edits[0].newText));
}

// ---------------------------------------------------------------------------
// .env.example commands
// ---------------------------------------------------------------------------

async function generateExample(uri?: vscode.Uri): Promise<void> {
  const doc = await resolveDocument(uri);
  if (!doc) {
    return;
  }
  const config = getConfig(doc);
  const target = siblingUri(doc.uri, config.exampleFileName);
  const output = envToExample(doc.getText(), { placeholder: config.examplePlaceholder });

  try {
    if (doc.uri.scheme !== 'file' || doc.isUntitled) {
      await openInNewTab(output, DOTENV_LANGUAGE);
      return;
    }

    if (await fileExists(target)) {
      const choice = await vscode.window.showWarningMessage(
        `Envify: ${config.exampleFileName} already exists.`,
        { modal: true },
        'Overwrite',
        'Open in New Tab'
      );
      if (choice === 'Open in New Tab') {
        await openInNewTab(output, DOTENV_LANGUAGE);
        return;
      }
      if (choice !== 'Overwrite') {
        return;
      }
    }

    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(output));
    const created = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(created, { preview: false });
    notify(`Generated ${config.exampleFileName}`);
  } catch (err) {
    fail(err);
  }
}

function appendKeysEdit(doc: vscode.TextDocument, keys: string[], placeholder: string): vscode.TextEdit {
  const text = doc.getText();
  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  const lines = keys.map((k) => `${k}=${placeholder}`).join('\n') + '\n';
  return vscode.TextEdit.insert(doc.positionAt(text.length), prefix + lines);
}

async function appendKeys(doc: vscode.TextDocument, keys: string[], placeholder: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.set(doc.uri, [appendKeysEdit(doc, keys, placeholder)]);
  await vscode.workspace.applyEdit(edit);
}

async function compareWithExample(uri?: vscode.Uri): Promise<void> {
  const doc = await resolveDocument(uri);
  if (!doc) {
    return;
  }
  const config = getConfig(doc);
  const exampleUri = siblingUri(doc.uri, config.exampleFileName);
  const exampleText = await readFileText(exampleUri);

  if (exampleText === undefined) {
    const choice = await vscode.window.showWarningMessage(
      `Envify: No ${config.exampleFileName} found next to ${basename(doc.uri)}.`,
      'Generate it'
    );
    if (choice) {
      await generateExample(doc.uri);
    }
    return;
  }

  const result = compareEnv(doc.getText(), exampleText);
  if (result.missing.length === 0 && result.extra.length === 0 && result.empty.length === 0) {
    vscode.window.showInformationMessage(`Envify: ${basename(doc.uri)} is in sync with ${config.exampleFileName}.`);
    return;
  }

  const parts: string[] = [];
  if (result.missing.length) {
    parts.push(`missing: ${result.missing.join(', ')}`);
  }
  if (result.empty.length) {
    parts.push(`empty: ${result.empty.join(', ')}`);
  }
  if (result.extra.length) {
    parts.push(`not in ${config.exampleFileName}: ${result.extra.join(', ')}`);
  }

  const actions: string[] = [];
  if (result.missing.length) {
    actions.push('Add missing keys');
  }
  actions.push(`Open ${config.exampleFileName}`);

  const choice = await vscode.window.showWarningMessage(`Envify: ${parts.join(' · ')}`, ...actions);
  if (choice === 'Add missing keys') {
    await appendKeys(doc, result.missing, config.examplePlaceholder);
    await vscode.window.showTextDocument(doc);
  } else if (choice) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(exampleUri));
  }
}

/** Code lens target: append the keys the document is missing from its `.env.example`, computed afresh. */
async function addMissingKeys(uri?: vscode.Uri): Promise<void> {
  const doc = await resolveDocument(uri);
  if (!doc) {
    return;
  }
  const config = getConfig(doc);
  const exampleText = await readFileText(siblingUri(doc.uri, config.exampleFileName));
  if (exampleText === undefined) {
    return;
  }
  const { missing } = compareEnv(doc.getText(), exampleText);
  if (missing.length) {
    await appendKeys(doc, missing, config.examplePlaceholder);
  }
}

// ---------------------------------------------------------------------------
// Compare .env files
// ---------------------------------------------------------------------------

/** Read-only, sorted view of an env file, shown on both sides of the compare diff. */
class NormalizedEnvProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly sources = new Set<string>();
  readonly onDidChange = this.emitter.event;

  uriFor(source: vscode.Uri): vscode.Uri {
    this.sources.add(source.toString());
    // Keep the source path so the tab shows the file name and gets dotenv highlighting.
    return vscode.Uri.from({ scheme: NORMALIZED_SCHEME, path: source.path, query: source.toString() });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri.query));
    return normalizeEnv(doc.getText(), { expandVariables: getConfig(doc).expandVariables });
  }

  /** Refresh an open diff while its source file is edited. */
  sourceChanged(doc: vscode.TextDocument): void {
    if (this.sources.has(doc.uri.toString())) {
      this.emitter.fire(this.uriFor(doc.uri));
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

interface FileChoice extends vscode.QuickPickItem {
  uri?: vscode.Uri;
}

/** Ask for the file to compare against: env files next to `source`, or any file via a dialog. */
async function pickEnvFile(source: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = source.scheme === 'untitled' ? undefined : vscode.Uri.joinPath(source, '..');
  const choices: FileChoice[] = [];
  if (folder) {
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
        if (type & vscode.FileType.File && ENV_FILENAME_PATTERN.test(name) && name !== basename(source)) {
          choices.push({ label: name, uri: vscode.Uri.joinPath(folder, name) });
        }
      }
    } catch {
      // Folder not listable (e.g. a virtual document): only browsing is possible.
    }
  }
  choices.sort((a, b) => a.label.localeCompare(b.label));
  choices.push({ label: '$(folder-opened) Browse…', description: 'Pick any file', alwaysShow: true });

  const choice = await vscode.window.showQuickPick(choices, { placeHolder: `Compare ${basename(source)} with…` });
  if (!choice) {
    return undefined;
  }
  if (choice.uri) {
    return choice.uri;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: folder,
    openLabel: 'Compare',
  });
  return picked?.[0];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function compareEnvFiles(
  provider: NormalizedEnvProvider,
  uri?: vscode.Uri,
  selected?: vscode.Uri[]
): Promise<void> {
  let left: vscode.Uri | undefined;
  let right: vscode.Uri | undefined;

  if (Array.isArray(selected) && selected.length > 1) {
    if (selected.length > 2) {
      vscode.window.showWarningMessage('Envify: Select exactly two files to compare.');
      return;
    }
    [left, right] = selected;
  } else {
    left = uri instanceof vscode.Uri ? uri : requireEditor()?.document.uri;
    if (!left) {
      return;
    }
    right = await pickEnvFile(left);
  }
  if (!right) {
    return;
  }
  if (left.toString() === right.toString()) {
    vscode.window.showWarningMessage('Envify: Pick two different files to compare.');
    return;
  }

  try {
    const [leftDoc, rightDoc] = await Promise.all([
      vscode.workspace.openTextDocument(left),
      vscode.workspace.openTextDocument(right),
    ]);
    const sameName = basename(left) === basename(right);
    const leftName = sameName ? vscode.workspace.asRelativePath(left) : basename(left);
    const rightName = sameName ? vscode.workspace.asRelativePath(right) : basename(right);

    const diff = diffEnv(leftDoc.getText(), rightDoc.getText(), {
      expandVariables: getConfig(leftDoc).expandVariables,
    });
    if (diff.onlyLeft.length === 0 && diff.onlyRight.length === 0 && diff.changed.length === 0) {
      vscode.window.showInformationMessage(
        `Envify: ${leftName} and ${rightName} have the same ${plural(diff.same.length, 'key')} and values.`
      );
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      provider.uriFor(left),
      provider.uriFor(right),
      `${leftName} ↔ ${rightName} (Envify)`
    );

    const parts: string[] = [];
    if (diff.onlyLeft.length) {
      parts.push(`only in ${leftName}: ${diff.onlyLeft.join(', ')}`);
    }
    if (diff.onlyRight.length) {
      parts.push(`only in ${rightName}: ${diff.onlyRight.join(', ')}`);
    }
    if (diff.changed.length) {
      parts.push(`different values: ${diff.changed.join(', ')}`);
    }

    // Missing keys are added with empty values: values usually differ per environment.
    const additions = new Map<string, { doc: vscode.TextDocument; keys: string[] }>();
    if (diff.onlyLeft.length) {
      additions.set(`Add ${plural(diff.onlyLeft.length, 'key')} to ${rightName}`, { doc: rightDoc, keys: diff.onlyLeft });
    }
    if (diff.onlyRight.length) {
      additions.set(`Add ${plural(diff.onlyRight.length, 'key')} to ${leftName}`, { doc: leftDoc, keys: diff.onlyRight });
    }

    const choice = await vscode.window.showInformationMessage(`Envify: ${parts.join(' · ')}`, ...additions.keys());
    const addition = choice ? additions.get(choice) : undefined;
    if (addition) {
      await appendKeys(addition.doc, addition.keys, '');
      await vscode.window.showTextDocument(addition.doc);
    }
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const MISSING_KEYS_CODE = 'missing-keys';

const SEVERITY: Record<EnvIssue['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

class EnvDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly refreshed = new vscode.EventEmitter<void>();
  /** Missing keys per document, consumed by the "Add missing keys" code action and code lens. */
  readonly missingKeys = new Map<string, string[]>();
  /** Fires whenever diagnostics (and `missingKeys`) of any document change. */
  readonly onDidRefresh = this.refreshed.event;

  schedule(doc: vscode.TextDocument, delay = 300): void {
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.refresh(doc);
      }, delay)
    );
  }

  async refresh(doc: vscode.TextDocument): Promise<void> {
    if (doc.isClosed) {
      this.clear(doc.uri);
      return;
    }
    const config = getConfig(doc);
    if (!config.diagnosticsEnabled || !isEnvDocument(doc)) {
      this.clear(doc.uri);
      return;
    }

    const text = doc.getText();
    const diagnostics = lintEnv(text).map((issue) => this.toDiagnostic(doc, issue));

    let missing: string[] = [];
    if (config.compareWithExample && !isExampleDocument(doc) && !doc.isUntitled) {
      const exampleText = await readFileText(siblingUri(doc.uri, config.exampleFileName));
      if (exampleText !== undefined) {
        missing = compareEnv(text, exampleText).missing;
      }
    }

    if (missing.length) {
      this.missingKeys.set(doc.uri.toString(), missing);
      const diag = new vscode.Diagnostic(
        doc.lineAt(0).range,
        `Missing keys from ${config.exampleFileName}: ${missing.join(', ')}`,
        vscode.DiagnosticSeverity.Warning
      );
      diag.source = DIAGNOSTIC_SOURCE;
      diag.code = MISSING_KEYS_CODE;
      diagnostics.push(diag);
    } else {
      // Also covers a deleted example file or a disabled setting, so stale keys never linger.
      this.missingKeys.delete(doc.uri.toString());
    }

    this.collection.set(doc.uri, diagnostics);
    this.refreshed.fire();
  }

  refreshAllOpen(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (isEnvDocument(doc)) {
        this.schedule(doc, 0);
      }
    }
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
    this.missingKeys.delete(uri.toString());
    this.refreshed.fire();
  }

  dispose(): void {
    for (const t of this.timers.values()) {
      clearTimeout(t);
    }
    this.collection.dispose();
    this.refreshed.dispose();
  }

  private toDiagnostic(doc: vscode.TextDocument, issue: EnvIssue): vscode.Diagnostic {
    const range = new vscode.Range(issue.line, issue.startCol, issue.line, issue.endCol);
    const diag = new vscode.Diagnostic(range, issue.message, SEVERITY[issue.severity]);
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = issue.code;
    if (issue.severity === 'hint') {
      diag.tags = [vscode.DiagnosticTag.Unnecessary];
    }
    if (issue.related) {
      const relRange = new vscode.Range(issue.related.line, issue.related.startCol, issue.related.line, issue.related.endCol);
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(new vscode.Location(doc.uri, relRange), issue.related.message),
      ];
    }
    return diag;
  }
}

// ---------------------------------------------------------------------------
// Code actions
// ---------------------------------------------------------------------------

class EnvCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly diagnostics: EnvDiagnostics) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== DIAGNOSTIC_SOURCE) {
        continue;
      }
      const action = this.fixFor(doc, diag);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  private fixFor(doc: vscode.TextDocument, diag: vscode.Diagnostic): vscode.CodeAction | undefined {
    const lineRange = doc.lineAt(diag.range.start.line).rangeIncludingLineBreak;
    const rangeText = doc.getText(diag.range);

    switch (diag.code) {
      case 'duplicate-key':
        return this.action('Remove duplicate definition', diag, doc, [vscode.TextEdit.delete(lineRange)]);

      case 'unquoted-spaces': {
        const quoted = `"${rangeText.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        return this.action('Wrap value in double quotes', diag, doc, [vscode.TextEdit.replace(diag.range, quoted)]);
      }

      case 'unclosed-quote': {
        const quote = rangeText[0];
        if (quote !== '"' && quote !== "'") {
          return undefined;
        }
        return this.action('Close the quote', diag, doc, [vscode.TextEdit.insert(diag.range.end, quote)]);
      }

      case 'invalid-line':
        return this.action('Comment out line', diag, doc, [
          vscode.TextEdit.insert(new vscode.Position(diag.range.start.line, 0), '# '),
        ]);

      case MISSING_KEYS_CODE: {
        const missing = this.diagnostics.missingKeys.get(doc.uri.toString());
        if (!missing?.length) {
          return undefined;
        }
        const placeholder = getConfig(doc).examplePlaceholder;
        return this.action(`Add missing key${missing.length > 1 ? 's' : ''}`, diag, doc, [
          appendKeysEdit(doc, missing, placeholder),
        ]);
      }

      default:
        return undefined;
    }
  }

  private action(
    title: string,
    diag: vscode.Diagnostic,
    doc: vscode.TextDocument,
    edits: vscode.TextEdit[]
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diag];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.set(doc.uri, edits);
    return action;
  }
}

// ---------------------------------------------------------------------------
// Code lens
// ---------------------------------------------------------------------------

/** `3 keys missing from .env.example | Add` on the first line, fed by the diagnostics pass. */
class EnvCodeLensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(private readonly diagnostics: EnvDiagnostics) {
    this.onDidChangeCodeLenses = diagnostics.onDidRefresh;
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const config = getConfig(doc);
    const missing = this.diagnostics.missingKeys.get(doc.uri.toString());
    if (!config.codeLensEnabled || !missing?.length || !isEnvDocument(doc)) {
      return [];
    }
    const range = doc.lineAt(0).range;
    return [
      new vscode.CodeLens(range, {
        title: `${plural(missing.length, 'key')} missing from ${config.exampleFileName}`,
        tooltip: missing.join(', '),
        command: 'envify.compareWithExample',
        arguments: [doc.uri],
      }),
      new vscode.CodeLens(range, {
        title: 'Add',
        tooltip: `Append ${missing.join(', ')}`,
        command: 'envify.addMissingKeys',
        arguments: [doc.uri],
      }),
    ];
  }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

const REFERENCE_AT_CURSOR = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::?-[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*/;

class EnvHoverProvider implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!isEnvDocument(doc)) {
      return undefined;
    }
    const envDoc = parseEnvDocument(doc.getText());
    const resolve = createResolver(envDoc);

    const refRange = doc.getWordRangeAtPosition(position, REFERENCE_AT_CURSOR);
    if (refRange) {
      const ref = doc.getText(refRange);
      const name = (ref.match(/[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray)[0];
      const value = resolve(name);
      const md = new vscode.MarkdownString();
      md.appendCodeblock(`${name}=${value === undefined ? '' : value}`, DOTENV_LANGUAGE);
      md.appendMarkdown(value === undefined ? `_${name} is not defined in this file_` : '_resolved from this file_');
      return new vscode.Hover(md, refRange);
    }

    const wordRange = doc.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }
    const word = doc.getText(wordRange);
    const entry = envDoc.lines.find(
      (l) => l.type === 'entry' && l.line === position.line && l.keyStart === wordRange.start.character && l.key === word
    );
    if (!entry || !KEY_PATTERN.test(word)) {
      return undefined;
    }

    const raw = entry.value as string;
    const expanded = resolve(word) ?? raw;
    const md = new vscode.MarkdownString();
    md.appendCodeblock(`${word}=${raw}`, DOTENV_LANGUAGE);
    if (expanded !== raw) {
      md.appendMarkdown('**Expanded**\n');
      md.appendCodeblock(`${word}=${expanded}`, DOTENV_LANGUAGE);
    }
    if (entry.quote === "'") {
      md.appendMarkdown('_single-quoted: taken literally, no expansion_');
    }
    return new vscode.Hover(md, wordRange);
  }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** Suggests keys from the same file after `${` (and after `$` when invoked manually). */
class EnvCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    if (!isEnvDocument(doc)) {
      return undefined;
    }
    const ctx = referenceCompletionAt(doc.getText(), position.line, position.character);
    if (!ctx) {
      return undefined;
    }

    const range = new vscode.Range(position.line, ctx.startCol, position.line, ctx.endCol);
    return ctx.candidates.map((entry, index) => {
      const key = entry.key as string;
      const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Variable);
      item.range = range;
      item.insertText = ctx.braced && !ctx.closed ? `${key}}` : key;
      item.sortText = String(index).padStart(5, '0');
      // No value here: the suggest widget pops up unasked, so it must not reveal secrets.
      item.detail = `Line ${entry.line + 1}`;
      return item;
    });
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new EnvDiagnostics();
  const normalized = new NormalizedEnvProvider();
  const selector: vscode.DocumentSelector = [
    { language: DOTENV_LANGUAGE },
    { pattern: '**/.env' },
    { pattern: '**/.env.*' },
    { pattern: '**/*.env' },
  ];

  context.subscriptions.push(
    diagnostics,
    normalized,

    vscode.commands.registerCommand('envify.envToJson', () => convertInPlace('envToJson')),
    vscode.commands.registerCommand('envify.jsonToEnv', () => convertInPlace('jsonToEnv')),
    vscode.commands.registerCommand('envify.envToJsonNewFile', () => convertToNewTab('envToJson')),
    vscode.commands.registerCommand('envify.jsonToEnvNewFile', () => convertToNewTab('jsonToEnv')),
    vscode.commands.registerCommand('envify.envToFormat', convertToFormat),
    vscode.commands.registerCommand('envify.copyAsJson', () => copyAs('envToJson')),
    vscode.commands.registerCommand('envify.copyAsEnv', () => copyAs('jsonToEnv')),
    vscode.commands.registerCommand('envify.formatDocument', formatCommand),
    vscode.commands.registerCommand('envify.generateExample', generateExample),
    vscode.commands.registerCommand('envify.compareWithExample', compareWithExample),
    // Not contributed to the palette: invoked from the code lens with the document's URI.
    vscode.commands.registerCommand('envify.addMissingKeys', addMissingKeys),
    vscode.commands.registerCommand('envify.compareEnvFiles', (uri?: vscode.Uri, selected?: vscode.Uri[]) =>
      compareEnvFiles(normalized, uri, selected)
    ),

    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits: (doc) => formatEdits(doc),
    }),
    vscode.languages.registerCodeActionsProvider(selector, new EnvCodeActionProvider(diagnostics), {
      providedCodeActionKinds: EnvCodeActionProvider.kinds,
    }),
    vscode.languages.registerHoverProvider(selector, new EnvHoverProvider()),
    vscode.languages.registerCodeLensProvider(selector, new EnvCodeLensProvider(diagnostics)),
    vscode.languages.registerCompletionItemProvider(selector, new EnvCompletionProvider(), '{'),
    vscode.workspace.registerTextDocumentContentProvider(NORMALIZED_SCHEME, normalized),

    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.schedule(doc, 0)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      diagnostics.schedule(e.document);
      normalized.sourceChanged(e.document);
      void suggestConvertPastedJson(e);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc.uri)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isEnvDocument(doc)) {
        diagnostics.refreshAllOpen();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('envify')) {
        diagnostics.refreshAllOpen();
      }
    })
  );

  diagnostics.refreshAllOpen();
}

export function deactivate(): void {}
