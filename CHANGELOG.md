# Changelog

## 1.4.0

### Parser fixes
- `export KEY=value` is now parsed instead of being silently dropped
- Inline comments (`KEY=value # note`) are stripped from unquoted values; `COLOR=#ff0000` still works
- Quoted values can span multiple lines (private keys, certificates)
- Invalid lines are reported after a conversion instead of vanishing silently
- Nested objects containing `'` are now quoted safely when converting JSON → .env
- Values with leading/trailing whitespace are quoted when converting JSON → .env

### New conversions
- `Envify: Convert .env to…` — YAML, shell `export` script, docker-compose `environment:`, Kubernetes ConfigMap, Kubernetes Secret (base64), `.env.example`
- `Envify: Copy .env as JSON` / `Copy JSON as .env`
- Type inference (`envify.json.inferTypes`), nested keys (`envify.nestedSeparator`), variable expansion (`envify.expandVariables`), key sorting, quote style and JSON indent settings

### .env.example
- `Envify: Generate .env.example` — keeps keys, comments and layout, blanks out values
- `Envify: Compare with .env.example` — lists missing, empty and extra keys, with an "Add missing keys" action
- Missing keys are reported in the Problems panel while a `.env` is open

### Language support
- `dotenv` language with syntax highlighting for `.env`, `.env.*` and `*.env` files
- Diagnostics: invalid lines, duplicate keys, unquoted values with spaces, unclosed quotes, undefined `${VAR}` references
- Quick fixes: wrap in quotes, remove duplicate, close quote, comment out line, add missing keys
- Hover shows a key's value and resolves `${VAR}` references
- Format Document is registered as a real formatter again (Format on Save works) while keeping the `Shift+Alt+F` command for editors that override language detection

### Other
- Context menu items moved into an **Envify** submenu; Explorer context menu gained `.env.example` commands
- `envify.showNotifications` to silence success toasts
- JSON → .env now sets the language to `dotenv` instead of plaintext

## 1.3.1

- Fix `.env` formatter compatibility with editors that override language detection (e.g. Cursor) — now implemented as a dedicated command instead of the formatter API

## 1.3.0

- Format .env Document (`Shift+Alt+F`) — trims whitespace around `=`, removes trailing spaces, collapses consecutive blank lines, ensures trailing newline
- Context menu now shows all commands regardless of file type for easy back-and-forth conversion

## 1.2.0

- Support selection-based conversion — select specific lines to convert only the selection
- "New File" commands now open result in an untitled tab instead of saving to disk

## 1.0.0

- Initial release
- Convert .env to JSON (in-place and new file)
- Convert JSON to .env (in-place and new file)
- Context menu support
- Keyboard shortcuts
