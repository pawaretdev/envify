# Envify

The `.env` toolkit for VS Code — convert `.env` to JSON, YAML, shell, docker-compose and Kubernetes, keep `.env` in sync with `.env.example`, and get syntax highlighting, linting, quick fixes and formatting for `.env` files. Zero dependencies, 100% offline.

## Support Further Development

[![GitHub Sponsors](https://img.shields.io/badge/-pawaretdev-black?style=for-the-badge&logo=githubsponsors&label=GitHub%20Sponsor%3A)](https://github.com/sponsors/pawaretdev)\
[![Buy Me a Coffee](https://img.shields.io/badge/-pawaretdev-black?style=for-the-badge&logo=buymeacoffee&label=Buy%20Me%20a%20Coffee%3A)](https://buymeacoffee.com/pawaretdev)

## Features

### Convert

- **`.env` → `JSON`** and **`JSON` → `.env`** — in place, in a new tab, or straight to the clipboard
- **`.env` → YAML, shell script, docker-compose `environment:`, Kubernetes ConfigMap / Secret** — pick a target from one command
- **Selection support** — select a few lines to convert only those
- **Options** — infer JSON types, nested keys (`DB__HOST` ⇄ `{"DB":{"HOST":…}}`), variable expansion (`${VAR}`), key sorting, quoting style

### `.env.example`

- **Generate `.env.example`** — same keys, comments and layout, values blanked out
- **Compare with `.env.example`** — see which keys are missing, empty or extra, and add the missing ones in one click
- **Missing keys show up as a warning** in the Problems panel whenever a `.env` file is open

### Language support for `.env`

- **Syntax highlighting** for keys, values, quotes, escapes, `${VAR}` references, `export` and comments
- **Diagnostics** — invalid lines, duplicate keys, unquoted values with spaces, unclosed quotes, undefined references
- **Quick fixes** — wrap in quotes, remove duplicate, close quote, comment out, add missing keys
- **Hover** — see a key's value, and `${VAR}` references resolved from the same file
- **Format Document** — trims whitespace around `=`, collapses blank lines, ensures a trailing newline (works with Format on Save)

## Usage

### Command Palette

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and search for:

| Command | Description |
|---------|-------------|
| `Envify: Convert .env to JSON` | Replace current content with JSON |
| `Envify: Convert JSON to .env` | Replace current content with .env |
| `Envify: Convert .env to JSON (New File)` | Open JSON result in a new tab |
| `Envify: Convert JSON to .env (New File)` | Open .env result in a new tab |
| `Envify: Convert .env to…` | Pick YAML, shell, docker-compose, Kubernetes ConfigMap / Secret or `.env.example` |
| `Envify: Copy .env as JSON` | Copy the JSON result to the clipboard |
| `Envify: Copy JSON as .env` | Copy the .env result to the clipboard |
| `Envify: Generate .env.example` | Write `.env.example` next to the current `.env` |
| `Envify: Compare with .env.example` | Report missing / empty / extra keys |
| `Envify: Format .env Document` | Clean up the current `.env` file |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+J` / `Cmd+Shift+J` | Convert .env → JSON |
| `Ctrl+Alt+E` / `Cmd+Alt+E` | Convert JSON → .env |
| `Shift+Alt+F` / `Shift+Option+F` | Format .env document |

### Right-Click Menu

Right-click in the editor and open the **Envify** submenu for every command. In the Explorer, right-click a `.env` file for **Generate .env.example** and **Compare with .env.example**.

## Examples

### .env → JSON

```env
# Database
DATABASE_URL=postgres://localhost:5432/mydb
export API_KEY=sk-1234567890 # inline comments are dropped
DEBUG=true
APP_NAME="My App"
PRIVATE_KEY="-----BEGIN KEY-----
abc
-----END KEY-----"
```

```json
{
  "DATABASE_URL": "postgres://localhost:5432/mydb",
  "API_KEY": "sk-1234567890",
  "DEBUG": "true",
  "APP_NAME": "My App",
  "PRIVATE_KEY": "-----BEGIN KEY-----\nabc\n-----END KEY-----"
}
```

With `envify.json.inferTypes` on, `DEBUG` becomes `true` (a boolean) and `PORT=3000` becomes `3000`. Quoted values always stay strings.

### Nested keys

With `envify.nestedSeparator` set to `__`:

```env
DB__HOST=localhost
DB__PORT=5432
```

```json
{ "DB": { "HOST": "localhost", "PORT": "5432" } }
```

Converting nested JSON back to `.env` flattens it the same way. With the separator left empty, nested objects are stringified: `CONFIG='{"a":1}'`.

### Variable expansion

With `envify.expandVariables` on:

```env
HOST=db
URL=postgres://${HOST}:5432
FALLBACK=${MISSING:-default}
LITERAL='${HOST}'
```

```json
{ "HOST": "db", "URL": "postgres://db:5432", "FALLBACK": "default", "LITERAL": "${HOST}" }
```

Supports `${VAR}`, `$VAR`, `${VAR:-default}`, `${VAR-default}` and `\$` for a literal dollar. Single-quoted values are never expanded. Only keys in the same file are used — the process environment is not consulted.

### Other targets

`Envify: Convert .env to…` opens the result in a new tab:

```yaml
# docker-compose
environment:
  DATABASE_URL: postgres://localhost:5432/mydb
  DEBUG: "true"
```

```yaml
# Kubernetes Secret
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
data:
  DATABASE_URL: cG9zdGdyZXM6Ly9sb2NhbGhvc3Q6NTQzMi9teWRi
```

```sh
# Shell
export DATABASE_URL='postgres://localhost:5432/mydb'
```

### .env.example

```env
# Database
DATABASE_URL=
export API_KEY= # inline comments are dropped
DEBUG=
APP_NAME=
PRIVATE_KEY=
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `envify.json.indent` | `2` | Indent size for JSON output |
| `envify.json.inferTypes` | `false` | Turn unquoted `true`/`false`/`null`/numbers into JSON types |
| `envify.json.sortKeys` | `false` | Sort keys when converting to JSON |
| `envify.env.quoteStyle` | `auto` | `auto` quotes only when needed, `always` quotes every value |
| `envify.env.sortKeys` | `false` | Sort keys when converting to .env |
| `envify.nestedSeparator` | `""` | Separator for nested keys, e.g. `__` |
| `envify.expandVariables` | `false` | Resolve `${VAR}` references during conversion |
| `envify.example.fileName` | `.env.example` | Name of the example file |
| `envify.example.placeholder` | `""` | Value written after `=` in generated examples |
| `envify.diagnostics.enabled` | `true` | Show problems in `.env` files |
| `envify.diagnostics.compareWithExample` | `true` | Warn about keys missing from `.env.example` |
| `envify.showNotifications` | `true` | Show a toast after each conversion |

## Parsing rules

- Blank lines and `#` comments are skipped; `export KEY=value` is accepted
- Unquoted values end at ` #` (a `#` preceded by whitespace), so `COLOR=#ff0000` keeps its value
- Double-quoted values resolve `\n`, `\r`, `\t`, `\"` and `\\`; single-quoted values are literal
- Quoted values may span multiple lines
- When a key is defined twice, the last value wins (and a warning is shown)
- Keys must match `[A-Za-z_][A-Za-z0-9_]*`; other lines are reported and skipped

## Privacy & Security

Envify works **100% offline**. Your `.env` secrets never leave your machine.

- No network requests — no data is sent to any server
- No telemetry or analytics
- No file writes except `.env.example` when you ask for it; the only file read besides the editor is the sibling `.env.example`
- Zero runtime dependencies — no third-party code runs behind the scenes
- Source code is open and auditable on [GitHub](https://github.com/pawaretdev/envify)

## License

MIT
