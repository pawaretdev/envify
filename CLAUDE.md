# Envify — Claude Code Instructions

## Project Overview

Envify is a VS Code extension for `.env` files: bidirectional `.env` ⇄ JSON conversion, export to YAML / shell / docker-compose / Kubernetes, `.env.example` generation and comparison, diffing two env files, and `dotenv` language support (highlighting, diagnostics, quick fixes, hover, `${` completion, snippets, formatter). Published on the VS Code Marketplace by `pawaretdev`.

**Current version:** 1.6.0  
**Publisher:** pawaretdev  
**Marketplace:** https://marketplace.visualstudio.com/items?itemName=pawaretdev.envify

## Architecture

```
src/
  converter.ts      — Pure conversion logic (no VS Code deps). Parser, converters, lint, compare, formats.
  extension.ts      — VS Code API layer. Commands, formatter, diagnostics, code actions, hover.
  converter.test.ts — Tests for converter.ts (run via node, no test framework)
syntaxes/dotenv.tmLanguage.json — TextMate grammar for the `dotenv` language
snippets/dotenv.json            — Snippets for the `dotenv` language (`env-block`)
language-configuration.json     — Comment/bracket config for `dotenv`
out/                — Compiled JS output (do not edit)
```

**Document model:** `parseEnvDocument(content)` returns `{ lines: EnvLine[] }` where each line is `entry | comment | blank | invalid` with positions, quote style, `export` flag and inline comment. Every other converter function (`parseEnv`, `envToJson`, `formatEnv`, `envToExample`, `lintEnv`, …) is built on it. Add new `.env` behaviour to the document model first, then to consumers.

**Key design rule:** `converter.ts` must remain free of VS Code dependencies. It is pure TypeScript so it can be tested without launching a VS Code host.

## Commands

| Command ID | Title | Shortcut |
|---|---|---|
| `envify.envToJson` | Convert .env → JSON (in-place) | `Cmd+Shift+J` |
| `envify.jsonToEnv` | Convert JSON → .env (in-place) | `Cmd+Alt+E` |
| `envify.envToJsonNewFile` | Convert .env → JSON (New Tab) | — |
| `envify.jsonToEnvNewFile` | Convert JSON → .env (New Tab) | — |
| `envify.envToFormat` | Quick pick: YAML / shell / docker-compose / k8s ConfigMap / k8s Secret / .env.example (New Tab) | — |
| `envify.copyAsJson` / `envify.copyAsEnv` | Convert to clipboard | — |
| `envify.formatDocument` | Format .env document | `Shift+Alt+F` |
| `envify.generateExample` | Write sibling `.env.example` (asks before overwriting) | — |
| `envify.compareWithExample` | Report missing / empty / extra keys vs `.env.example` | — |
| `envify.compareEnvFiles` | Pick a second env file (siblings or Browse…) and open `vscode.diff` of both, normalised | — |
| `envify.addMissingKeys` | Internal (not in `package.json`): code lens target, appends keys missing from `.env.example` | — |

Conversion commands support **selection-based conversion** — if text is selected, only the selection is converted. Language mode is updated only on full-file conversions. `generateExample` / `compareWithExample` accept an optional `Uri` (Explorer context menu); `compareEnvFiles` also takes the Explorer multi-selection and skips the picker when exactly two files are selected. Its diff sides are read-only `envify-normalized:` documents served by `NormalizedEnvProvider` (`normalizeEnv` of the source document, refreshed on every edit of the source).

Editor context menu items live in the `envify.editorSubmenu` submenu. Settings are read through `getConfig()` in `extension.ts`; add new ones to `package.json` `contributes.configuration` and to `EnvifyConfig`.

## Language features (`dotenv`)

- Language id `dotenv`, files `.env`, `.env.*`, `*.env`. Diagnostics/hover/code actions also apply by filename so they work when another extension or editor overrides the language id.
- Diagnostics come from `lintEnv` (codes: `invalid-line`, `duplicate-key`, `unquoted-spaces`, `unclosed-quote`, `undefined-reference`) plus `missing-keys` computed in `extension.ts` from `compareEnv` against the sibling example file. Each code has a matching quick fix in `EnvCodeActionProvider`.
- Diagnostics are debounced (300 ms) per document and refreshed for all open env docs on save or config change.
- Code lens (`EnvCodeLensProvider`) reads `EnvDiagnostics.missingKeys` and refreshes on `EnvDiagnostics.onDidRefresh`; it only appears when diagnostics and `compareWithExample` are on. `addMissingKeys` recomputes the missing keys itself rather than trusting the (debounced) map.
- Completion items show key names and line numbers only — never values, because the suggest widget opens without the user asking to see a secret. Hover is the explicit way to see a value.
- Completion (`EnvCompletionProvider`, trigger `{`) delegates to `referenceCompletionAt` in `converter.ts`, which decides whether the cursor is on a `${…}` / `$…` reference inside a value and lists the candidate keys. `language-configuration.json` auto-closes `${` with `}`, so completions insert only the name when a `}` already follows.

## Tech Stack

- **Language:** TypeScript 5.3
- **Runtime:** VS Code Extension Host (Node.js)
- **Minimum VS Code:** 1.80.0
- **Build:** `tsc` (no bundler)
- **Packaging:** `@vscode/vsce`
- **Test runner:** Node.js directly (no Jest/Vitest — tests compiled to `out/converter.test.js` and run with `node`)

## Development Workflow

```bash
# Install dependencies
npm install

# Compile (watch mode during development)
npm run watch

# Run tests
npm test

# Package extension
npm run package          # produces .vsix file

# Publish
npm run publish:vscode   # VS Code Marketplace
npm run publish:ovsx     # Open VSX Registry
```

To test in VS Code: press `F5` in VS Code to launch Extension Development Host.

## Coding Conventions

- No external runtime dependencies — keep the extension lightweight
- `converter.ts` exports pure functions only. Main entry points: `parseEnvDocument`, `parseEnv`, `envToJson`, `jsonToEnv`, `formatEnv`, `envToExample`, `compareEnv`, `diffEnv`, `normalizeEnv`, `lintEnv`, `referenceCompletionAt`, `envToYaml`, `envToShell`, `envToDockerCompose`, `envToKubernetesConfigMap`, `envToKubernetesSecret`
- Options are passed as plain objects (`EnvToJsonOptions`, `JsonToEnvOptions`, …) with defaults inside the function
- Error messages are surfaced via `vscode.window.showErrorMessage` — never throw unhandled in command handlers
- Conversion functions must throw a descriptive `Error` on invalid input (not return null/undefined)
- `.env` key validation pattern: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
- Add a CHANGELOG entry under **Unreleased** for user-visible changes
- Commit messages follow Conventional Commits in English: `type(scope): subject`, imperative, lowercase, no trailing period. Pull requests are squash-merged with the PR title as the commit message

## Conversion Rules (important invariants)

**`.env` parsing:**
- Skip blank lines and `#` comments; accept an `export ` prefix
- Support single and double quoted values (strip quotes); quoted values may span multiple lines
- Double-quoted values: resolve escape sequences (`\n`, `\r`, `\t`, `\"`, `\\`)
- Single-quoted values: literal (no escape processing, never expanded)
- Unquoted values: an inline comment starts at a `#` preceded by whitespace (`COLOR=#ff0000` is a value, `KEY=x # c` is `x`)
- Unclosed quote: the single line is taken literally (quote char included) and reported by `lintEnv`. The same literal reading applies when text other than a comment follows the closing quote, so no text is ever dropped; `lintEnv` reports it only if the quote did not close on its own line
- Later duplicates win. Invalid lines are skipped by `parseEnv` and reported by `lintEnv`
- Variable expansion is opt-in (`expandVariables`): `${VAR}`, `$VAR`, `${VAR:-d}`, `${VAR-d}`, `\$`; only keys in the same file, cycles resolve to `""`

**`.env` → JSON:**
- `inferTypes` only applies to unquoted values; leading-zero numbers and unsafe integers stay strings
- `nestedSeparator` splits keys into nested objects; keys with an empty or `__proto__` segment stay flat; a key used as both a value and an object throws
- Content with invalid lines but no entries throws instead of producing `{}`

**JSON → `.env`:**
- Nested objects are stringified with single-quoted `'...'` wrapper, or double-quoted with escaping if the JSON contains `'`; with `nestedSeparator` set they are flattened instead (arrays are always stringified)
- Values containing whitespace, `#`, `"`, `'`, `\`, newline, leading/trailing whitespace, or empty string → double-quoted with escaping (`quoteStyle: 'always'` quotes everything)
- In `auto` style, a value with a bare `$NAME` and no `${`, `'` or newline → single-quoted so tools that expand variables keep it literal
- Invalid key (including flattened keys) → throw with descriptive message

**`.env` formatting (`formatEnv`):**
- Trim whitespace around `=` and trailing whitespace; keep `export`, quotes, inline comments and multi-line values as written
- Collapse consecutive blank lines to one
- Ensure single trailing newline
- Must be idempotent

**`.env.example` (`envToExample`):** same layout as `formatEnv`, values replaced by the placeholder, invalid lines dropped because they may hold a secret.

**Comparing two env files:** `diffEnv` compares parsed values (after optional expansion) and reports `onlyLeft` / `onlyRight` / `changed` / `same`. `normalizeEnv` prints one `KEY=value` line per key, sorted, re-quoted with `formatEnvValue`, so order, comments, `export` and quoting style never show up as differences. Key lookups use own-property checks (`hasKey`) so names like `constructor` work.

**Other formats:** YAML scalars are quoted whenever a plain scalar could be misread (booleans, numbers, `: `, `#`, empty). docker-compose output doubles `$` in single-quoted values. ConfigMap values are always quoted. Secret values are base64.

## Testing

Tests live in `src/converter.test.ts` and compile to `out/converter.test.js`. They use Node's built-in `assert` — no test framework. Add tests here for any new converter behavior. `extension.ts` has no automated tests; verify it with `F5`.

```bash
npm test   # compiles + runs node out/converter.test.js
```

## Release Process

1. Move the **Unreleased** notes in `CHANGELOG.md` under the new version
2. Bump with `npm version <x.y.z> --no-git-tag-version` and update **Current version** above
3. Commit as `chore(release): x.y.z`, then wait for CI on `main`
4. Push tag `vx.y.z`: the Release workflow publishes to Open VSX and the VS Code Marketplace. Do not also run `npm run publish:*`

## What NOT to do

- Do not add runtime npm dependencies — this extension must remain zero-dependency
- Do not import `vscode` in `converter.ts`
- Do not use a bundler (webpack/esbuild) unless explicitly discussed — current `tsc` output is sufficient
- Do not commit `.vsix` files to git (they are build artifacts)
- Do not read files from `extension.ts` other than the sibling `.env.example` and the files the user picks in Compare .env Files, and do not write any file but `.env.example` — the README's Privacy section promises this
