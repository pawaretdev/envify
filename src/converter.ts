/**
 * Core conversion logic for Envify.
 *
 * This module is pure TypeScript with no VS Code dependency so it can be
 * unit-tested with plain Node. Everything the extension does with `.env`
 * content goes through the document model produced by `parseEnvDocument`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuoteChar = '"' | "'";

export type EnvLineType = 'entry' | 'comment' | 'blank' | 'invalid';

export interface EnvLine {
  type: EnvLineType;
  /** 0-based index of the first source line */
  line: number;
  /** 0-based index of the last source line (differs from `line` for multi-line quoted values) */
  endLine: number;
  /** Source text of the logical line (may contain newlines for multi-line values) */
  raw: string;
  /** Entry only: variable name */
  key?: string;
  /** Entry only: parsed value (quotes stripped, escapes resolved) */
  value?: string;
  /** Entry only: value text exactly as written, including quotes */
  rawValue?: string;
  /** Entry only: quote character used, or null when unquoted */
  quote?: QuoteChar | null;
  /** Entry only: true when the line starts with `export ` */
  exported?: boolean;
  /** Entry only: inline comment following the value (starting at `#`) */
  inlineComment?: string;
  /** Entry only: column of the key on the first line */
  keyStart?: number;
  /** Entry only: column just past the key on the first line */
  keyEnd?: number;
  /** Entry only: column where the raw value starts on the first line */
  valueStart?: number;
  /** Entry only: column just past the raw value on the first line (single-line values only) */
  valueEnd?: number;
  /** Entry only: the value opened a quote that was never closed */
  unclosedQuote?: boolean;
  /** Invalid only: human readable reason */
  reason?: string;
}

export interface EnvDocument {
  lines: EnvLine[];
}

export interface ParseEnvOptions {
  /** Resolve `${VAR}`, `$VAR`, `${VAR:-default}` references using other keys in the file */
  expandVariables?: boolean;
}

export interface EnvToJsonOptions extends ParseEnvOptions {
  /** Indent size for JSON output (default: 2) */
  indent?: number;
  /** Convert unquoted `true`/`false`/`null`/numbers to native JSON types */
  inferTypes?: boolean;
  /** Split keys on this separator into nested objects (e.g. `__`). Empty string disables. */
  nestedSeparator?: string;
  /** Sort object keys alphabetically (recursively) */
  sortKeys?: boolean;
}

/** @deprecated Use EnvToJsonOptions */
export type ConvertOptions = EnvToJsonOptions;

export interface JsonToEnvOptions {
  /** `auto` quotes only when needed, `always` double-quotes every value */
  quoteStyle?: 'auto' | 'always';
  /** Flatten nested objects using this separator instead of stringifying them. Empty string disables. */
  nestedSeparator?: string;
  /** Sort keys alphabetically */
  sortKeys?: boolean;
}

export interface EnvToExampleOptions {
  /** Text placed after `=` for every key (default: empty) */
  placeholder?: string;
}

export interface EnvComparison {
  /** Keys present in the example but missing from the env file */
  missing: string[];
  /** Keys present in the env file but not in the example */
  extra: string[];
  /** Keys present in both, but empty in the env file */
  empty: string[];
}

export type EnvIssueCode =
  | 'invalid-line'
  | 'duplicate-key'
  | 'unquoted-spaces'
  | 'unclosed-quote'
  | 'undefined-reference';

export type EnvIssueSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface EnvIssue {
  code: EnvIssueCode;
  severity: EnvIssueSeverity;
  message: string;
  /** 0-based line */
  line: number;
  startCol: number;
  endCol: number;
  /** Optional pointer to a related location (e.g. the first definition of a duplicate key) */
  related?: { line: number; startCol: number; endCol: number; message: string };
}

export type EnvOutputFormat =
  | 'json'
  | 'yaml'
  | 'shell'
  | 'docker-compose'
  | 'k8s-configmap'
  | 'k8s-secret'
  | 'example';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ENTRY_PATTERN = /^(\s*)(export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(\s*=\s*)(.*)$/;

const REFERENCE_PATTERN = /\\\$|\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?:(:?-)([^}]*))?\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function unescapeDoubleQuoted(inner: string): string {
  // Single pass so that `\\n` becomes a literal backslash followed by `n`.
  return inner.replace(/\\(.)/gs, (_, c: string) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '"': return '"';
      case '\\': return '\\';
      default: return '\\' + c;
    }
  });
}

/** Index of the closing quote in `text` starting the search at `from`, or -1. */
function findClosingQuote(text: string, quote: QuoteChar, from: number): number {
  if (quote === "'") {
    return text.indexOf("'", from);
  }
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"') {
      return i;
    }
  }
  return -1;
}

/**
 * Split an unquoted value into the value and an optional inline comment.
 * A `#` starts a comment only when preceded by whitespace (`spaceBefore` says whether
 * whitespace separated `=` from the value), so `COLOR=#ff0000` and `a#b` are kept intact.
 */
function splitInlineComment(rest: string, spaceBefore: boolean): { value: string; comment?: string } {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '#' && (i === 0 ? spaceBefore : /\s/.test(rest[i - 1]))) {
      return { value: rest.slice(0, i).trimEnd(), comment: rest.slice(i).trimEnd() };
    }
  }
  return { value: rest.trimEnd() };
}

/**
 * Parse `.env` content into a line-oriented document model that preserves
 * comments, blank lines, quoting style and positions.
 */
export function parseEnvDocument(content: string): EnvDocument {
  const src = content.split(/\r?\n/);
  const lines: EnvLine[] = [];
  let i = 0;

  while (i < src.length) {
    const text = src[i];
    const trimmed = text.trim();

    if (trimmed === '') {
      lines.push({ type: 'blank', line: i, endLine: i, raw: text });
      i++;
      continue;
    }

    if (trimmed.startsWith('#')) {
      lines.push({ type: 'comment', line: i, endLine: i, raw: text });
      i++;
      continue;
    }

    const match = text.match(ENTRY_PATTERN);
    if (!match) {
      const eq = text.indexOf('=');
      let reason: string;
      if (eq < 0) {
        reason = "Missing '=' (expected KEY=value)";
      } else {
        const keyText = text.slice(0, eq).replace(/^\s*export\s+/, '').trim();
        reason = keyText === ''
          ? 'Missing key name before "="'
          : `Invalid key name "${keyText}". Keys must start with a letter or underscore and contain only letters, digits, and underscores.`;
      }
      lines.push({ type: 'invalid', line: i, endLine: i, raw: text, reason });
      i++;
      continue;
    }

    const [, lead, exportPrefix, key, separator, rest] = match;
    const keyStart = lead.length + (exportPrefix ? exportPrefix.length : 0);
    const keyEnd = keyStart + key.length;
    const valueStart = keyEnd + separator.length;
    const spaceBefore = /\s$/.test(separator);
    const first = rest[0];

    if (first === '"' || first === "'") {
      let endLine = i;
      let body = rest;
      let closeIdx = findClosingQuote(body, first, 1);

      while (closeIdx < 0 && endLine + 1 < src.length) {
        endLine++;
        body += '\n' + src[endLine];
        closeIdx = findClosingQuote(body, first, 1);
      }

      if (closeIdx >= 0) {
        const rawValue = body.slice(0, closeIdx + 1);
        const inner = body.slice(1, closeIdx);
        const afterTrim = body.slice(closeIdx + 1).trim();
        lines.push({
          type: 'entry',
          line: i,
          endLine,
          raw: src.slice(i, endLine + 1).join('\n'),
          key,
          value: first === '"' ? unescapeDoubleQuoted(inner) : inner,
          rawValue,
          quote: first,
          exported: Boolean(exportPrefix),
          inlineComment: afterTrim.startsWith('#') ? afterTrim : undefined,
          keyStart,
          keyEnd,
          valueStart,
          valueEnd: endLine === i ? valueStart + rawValue.length : undefined,
        });
        i = endLine + 1;
        continue;
      }

      // Unclosed quote: fall back to treating this single line as an unquoted value.
      const { value, comment } = splitInlineComment(rest, spaceBefore);
      lines.push({
        type: 'entry',
        line: i,
        endLine: i,
        raw: text,
        key,
        value,
        rawValue: value,
        quote: null,
        exported: Boolean(exportPrefix),
        inlineComment: comment,
        keyStart,
        keyEnd,
        valueStart,
        valueEnd: valueStart + value.length,
        unclosedQuote: true,
      });
      i++;
      continue;
    }

    const { value, comment } = splitInlineComment(rest, spaceBefore);
    lines.push({
      type: 'entry',
      line: i,
      endLine: i,
      raw: text,
      key,
      value,
      rawValue: value,
      quote: null,
      exported: Boolean(exportPrefix),
      inlineComment: comment,
      keyStart,
      keyEnd,
      valueStart,
      valueEnd: valueStart + value.length,
    });
    i++;
  }

  return { lines };
}

/** Entries of a document (type === 'entry'), in source order. */
export function envEntries(doc: EnvDocument): EnvLine[] {
  return doc.lines.filter((l) => l.type === 'entry');
}

// ---------------------------------------------------------------------------
// Variable expansion
// ---------------------------------------------------------------------------

/**
 * Expand `${VAR}`, `$VAR`, `${VAR:-default}` and `${VAR-default}` references in a value.
 * `\$` produces a literal `$`. Unknown references expand to an empty string.
 */
export function expandValue(
  value: string,
  lookup: (name: string) => string | undefined,
  depth = 0
): string {
  if (depth > 20) {
    return value;
  }
  return value.replace(REFERENCE_PATTERN, (m, braced?: string, op?: string, def?: string, bare?: string) => {
    if (m === '\\$') {
      return '$';
    }
    const name = (braced ?? bare) as string;
    const found = lookup(name);
    if (op === ':-') {
      return found !== undefined && found !== ''
        ? found
        : expandValue(def ?? '', lookup, depth + 1);
    }
    if (op === '-') {
      return found !== undefined ? found : expandValue(def ?? '', lookup, depth + 1);
    }
    return found ?? '';
  });
}

/** Names referenced by a value (`${NAME}` or `$NAME`), ignoring escaped `\$`. */
export function referencedNames(value: string): string[] {
  const names: string[] = [];
  for (const m of value.matchAll(REFERENCE_PATTERN)) {
    if (m[0] === '\\$') {
      continue;
    }
    names.push((m[1] ?? m[4]) as string);
  }
  return names;
}

/**
 * Build a resolver over a document. Single-quoted values are literal and never expanded,
 * matching dotenv-expand behaviour. Cycles resolve to an empty string.
 */
export function createResolver(doc: EnvDocument): (name: string) => string | undefined {
  const raw = new Map<string, EnvLine>();
  for (const entry of envEntries(doc)) {
    raw.set(entry.key as string, entry);
  }
  const memo = new Map<string, string>();
  const resolving = new Set<string>();

  const resolve = (name: string): string | undefined => {
    const entry = raw.get(name);
    if (!entry) {
      return undefined;
    }
    if (memo.has(name)) {
      return memo.get(name);
    }
    if (resolving.has(name)) {
      return '';
    }
    resolving.add(name);
    const value = entry.value as string;
    const result = entry.quote === "'" ? value : expandValue(value, resolve);
    resolving.delete(name);
    memo.set(name, result);
    return result;
  };

  return resolve;
}

// ---------------------------------------------------------------------------
// parseEnv / envToJson
// ---------------------------------------------------------------------------

/**
 * Parse .env content into a key-value object. Later duplicates win.
 * Invalid lines are skipped; use `lintEnv` to surface them.
 */
export function parseEnv(content: string, options: ParseEnvOptions = {}): Record<string, string> {
  const doc = parseEnvDocument(content);
  const resolve = options.expandVariables ? createResolver(doc) : undefined;
  const result: Record<string, string> = {};

  for (const entry of envEntries(doc)) {
    const key = entry.key as string;
    result[key] = resolve ? (resolve(key) as string) : (entry.value as string);
  }

  return result;
}

/** Convert an unquoted string into a native JSON type when it looks like one. */
export function inferType(value: string): string | number | boolean | null {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (value.includes('.') || Number.isSafeInteger(n)) {
      return n;
    }
  }
  return value;
}

type JsonObject = { [key: string]: unknown };

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setNested(target: JsonObject, path: string[], value: unknown): void {
  let current = target;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i];
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as JsonObject;
  }
  current[path[path.length - 1]] = value;
}

function sortObjectKeys(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortObjectKeys(value[key]);
  }
  return sorted;
}

/**
 * Convert .env content to a JSON object (not yet stringified).
 */
export function envToObject(content: string, options: EnvToJsonOptions = {}): JsonObject {
  const { inferTypes = false, nestedSeparator = '', sortKeys = false, expandVariables = false } = options;
  const doc = parseEnvDocument(content);
  const resolve = expandVariables ? createResolver(doc) : undefined;
  const result: JsonObject = {};

  for (const entry of envEntries(doc)) {
    const key = entry.key as string;
    const stringValue = resolve ? (resolve(key) as string) : (entry.value as string);
    const value: unknown = inferTypes && entry.quote === null ? inferType(stringValue) : stringValue;

    if (nestedSeparator) {
      const path = key.split(nestedSeparator);
      if (path.length > 1 && path.every((p) => p !== '')) {
        setNested(result, path, value);
        continue;
      }
    }
    result[key] = value;
  }

  return (sortKeys ? sortObjectKeys(result) : result) as JsonObject;
}

/**
 * Convert .env content string to JSON string
 */
export function envToJson(content: string, options: EnvToJsonOptions = {}): string {
  const { indent = 2 } = options;
  return JSON.stringify(envToObject(content, options), null, indent);
}

// ---------------------------------------------------------------------------
// jsonToEnv
// ---------------------------------------------------------------------------

function escapeDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Format a value for a `.env` line, quoting only when needed (or always). */
export function formatEnvValue(value: unknown, quoteStyle: 'auto' | 'always' = 'auto'): string {
  if (typeof value === 'object' && value !== null) {
    const json = JSON.stringify(value);
    if (quoteStyle === 'always' || json.includes("'")) {
      return `"${escapeDoubleQuoted(json)}"`;
    }
    return `'${json}'`;
  }

  const str = String(value);
  const needsQuotes =
    quoteStyle === 'always' ||
    str === '' ||
    str !== str.trim() ||
    /[\s#"'\\]/.test(str) ||
    str.includes('\n') ||
    str.includes('\r');

  return needsQuotes ? `"${escapeDoubleQuoted(str)}"` : str;
}

function flattenObject(obj: JsonObject, separator: string, prefix = ''): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key;
    if (separator && isPlainObject(value) && Object.keys(value).length > 0) {
      pairs.push(...flattenObject(value, separator, fullKey));
    } else {
      pairs.push([fullKey, value]);
    }
  }
  return pairs;
}

/**
 * Convert JSON string to .env content string
 */
export function jsonToEnv(content: string, options: JsonToEnvOptions = {}): string {
  const { quoteStyle = 'auto', nestedSeparator = '', sortKeys = false } = options;
  const parsed: unknown = JSON.parse(content);

  if (!isPlainObject(parsed)) {
    throw new Error('JSON must be a flat object with string values');
  }

  let pairs = flattenObject(parsed, nestedSeparator);
  if (sortKeys) {
    pairs = pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  const lines: string[] = [];
  for (const [key, value] of pairs) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error(
        `Invalid .env key: "${key}". Keys must start with a letter or underscore and contain only letters, digits, and underscores.`
      );
    }
    lines.push(`${key}=${formatEnvValue(value, quoteStyle)}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Document serialisation: formatEnv / envToExample
// ---------------------------------------------------------------------------

function serializeEntry(entry: EnvLine, rawValue: string): string {
  const prefix = entry.exported ? 'export ' : '';
  const comment = entry.inlineComment ? ` ${entry.inlineComment}` : '';
  return `${prefix}${entry.key}=${rawValue}${comment}`;
}

/**
 * Rebuild a document as text, normalising whitespace, collapsing blank runs
 * and guaranteeing a single trailing newline. `mapValue` lets callers rewrite entry values.
 */
function serializeDocument(doc: EnvDocument, mapValue: (entry: EnvLine) => string): string {
  const result: string[] = [];
  let prevWasBlank = false;

  for (const line of doc.lines) {
    if (line.type === 'blank') {
      if (!prevWasBlank) {
        result.push('');
      }
      prevWasBlank = true;
      continue;
    }
    prevWasBlank = false;

    switch (line.type) {
      case 'entry':
        result.push(serializeEntry(line, mapValue(line)));
        break;
      case 'comment':
      case 'invalid':
      default:
        result.push(line.raw.trim());
        break;
    }
  }

  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }

  return result.join('\n') + '\n';
}

/**
 * Format .env content: trim whitespace around =, trim trailing whitespace,
 * collapse consecutive blank lines, ensure trailing newline.
 * Multi-line quoted values, comments and `export` prefixes are preserved.
 */
export function formatEnv(content: string): string {
  const doc = parseEnvDocument(content);
  return serializeDocument(doc, (entry) => entry.rawValue as string);
}

/**
 * Produce a `.env.example`: same keys, comments and layout, values blanked out.
 */
export function envToExample(content: string, options: EnvToExampleOptions = {}): string {
  const { placeholder = '' } = options;
  const doc = parseEnvDocument(content);
  return serializeDocument(doc, () => placeholder);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a `.env` file against its `.env.example`.
 */
export function compareEnv(envContent: string, exampleContent: string): EnvComparison {
  const env = parseEnv(envContent);
  const example = parseEnv(exampleContent);
  const envKeys = Object.keys(env);
  const exampleKeys = Object.keys(example);

  return {
    missing: exampleKeys.filter((k) => !(k in env)),
    extra: envKeys.filter((k) => !(k in example)),
    empty: envKeys.filter((k) => k in example && env[k] === ''),
  };
}

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

/**
 * Report problems in a `.env` file. Positions are 0-based.
 */
export function lintEnv(content: string): EnvIssue[] {
  const doc = parseEnvDocument(content);
  const issues: EnvIssue[] = [];
  const firstSeen = new Map<string, EnvLine>();
  const definedKeys = new Set<string>();

  for (const entry of envEntries(doc)) {
    definedKeys.add(entry.key as string);
  }

  for (const line of doc.lines) {
    if (line.type === 'invalid') {
      const startCol = line.raw.length - line.raw.trimStart().length;
      issues.push({
        code: 'invalid-line',
        severity: 'error',
        message: line.reason as string,
        line: line.line,
        startCol,
        endCol: line.raw.trimEnd().length,
      });
      continue;
    }

    if (line.type !== 'entry') {
      continue;
    }

    const key = line.key as string;
    const keyStart = line.keyStart as number;
    const keyEnd = line.keyEnd as number;
    const valueStart = line.valueStart as number;
    const valueEnd = line.valueEnd ?? line.raw.split('\n')[0].length;

    const previous = firstSeen.get(key);
    if (previous) {
      issues.push({
        code: 'duplicate-key',
        severity: 'warning',
        message: `Duplicate key "${key}" (first defined on line ${previous.line + 1}). The last value wins.`,
        line: line.line,
        startCol: keyStart,
        endCol: keyEnd,
        related: {
          line: previous.line,
          startCol: previous.keyStart as number,
          endCol: previous.keyEnd as number,
          message: `First definition of "${key}"`,
        },
      });
    } else {
      firstSeen.set(key, line);
    }

    if (line.unclosedQuote) {
      issues.push({
        code: 'unclosed-quote',
        severity: 'warning',
        message: 'Unclosed quote. The value is read literally, including the quote character.',
        line: line.line,
        startCol: valueStart,
        endCol: valueEnd,
      });
    } else if (line.quote === null && /\s/.test(line.value as string)) {
      issues.push({
        code: 'unquoted-spaces',
        severity: 'info',
        message: 'Value contains whitespace but is not quoted. Some tools will truncate it; wrap it in quotes.',
        line: line.line,
        startCol: valueStart,
        endCol: valueEnd,
      });
    }

    if (line.quote !== "'" && (line.value as string).includes('$')) {
      for (const name of referencedNames(line.value as string)) {
        if (!definedKeys.has(name)) {
          issues.push({
            code: 'undefined-reference',
            severity: 'hint',
            message: `"${name}" is referenced but not defined in this file. It will resolve from the process environment or expand to an empty string.`,
            line: line.line,
            startCol: valueStart,
            endCol: valueEnd,
          });
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Other output formats
// ---------------------------------------------------------------------------

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shell script with `export KEY='value'` lines (POSIX single-quote escaping).
 */
export function envToShell(content: string, options: ParseEnvOptions = {}): string {
  const vars = parseEnv(content, options);
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n') + (Object.keys(vars).length ? '\n' : '');
}

const YAML_RESERVED = /^(true|false|yes|no|on|off|null|y|n|~)$/i;
const YAML_NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const YAML_PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_.\/@+:-]*$/;

/** Render a string as a YAML scalar, quoting whenever a plain scalar could be misread. */
export function yamlScalar(value: string, alwaysQuote = false): string {
  const plainSafe =
    !alwaysQuote &&
    YAML_PLAIN.test(value) &&
    !YAML_RESERVED.test(value) &&
    !YAML_NUMBER.test(value) &&
    !/^0[xob]/i.test(value) &&
    !value.includes(': ') &&
    !value.endsWith(':');
  return plainSafe ? value : JSON.stringify(value);
}

function yamlMap(vars: Record<string, string>, indent: string, alwaysQuote = false): string {
  return Object.entries(vars)
    .map(([key, value]) => `${indent}${key}: ${yamlScalar(value, alwaysQuote)}`)
    .join('\n');
}

/**
 * Flat YAML mapping.
 */
export function envToYaml(content: string, options: ParseEnvOptions = {}): string {
  const vars = parseEnv(content, options);
  const body = yamlMap(vars, '');
  return body ? body + '\n' : '{}\n';
}

/**
 * docker-compose `environment:` block (map form) ready to paste under a service.
 */
export function envToDockerCompose(content: string, options: ParseEnvOptions = {}): string {
  const vars = parseEnv(content, options);
  const body = yamlMap(vars, '  ');
  return `environment:\n${body ? body + '\n' : '  {}\n'}`;
}

export interface KubernetesOptions extends ParseEnvOptions {
  /** metadata.name for the resource */
  name?: string;
  /** metadata.namespace (omitted when empty) */
  namespace?: string;
}

function kubernetesHeader(kind: string, name: string, namespace?: string): string {
  const lines = ['apiVersion: v1', `kind: ${kind}`, 'metadata:', `  name: ${name}`];
  if (namespace) {
    lines.push(`  namespace: ${namespace}`);
  }
  return lines.join('\n');
}

/**
 * Kubernetes ConfigMap. Every value is quoted because ConfigMap data must be strings.
 */
export function envToKubernetesConfigMap(content: string, options: KubernetesOptions = {}): string {
  const { name = 'app-config', namespace } = options;
  const vars = parseEnv(content, options);
  const body = yamlMap(vars, '  ', true);
  return `${kubernetesHeader('ConfigMap', name, namespace)}\ndata:\n${body ? body + '\n' : '  {}\n'}`;
}

function base64(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Kubernetes Secret (type Opaque) with base64-encoded `data`.
 */
export function envToKubernetesSecret(content: string, options: KubernetesOptions = {}): string {
  const { name = 'app-secret', namespace } = options;
  const vars = parseEnv(content, options);
  const body = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${base64(value)}`)
    .join('\n');
  return `${kubernetesHeader('Secret', name, namespace)}\ntype: Opaque\ndata:\n${body ? body + '\n' : '  {}\n'}`;
}
