# Envify

Instantly convert between `.env` and `JSON` formats — bidirectional, fast, and simple.

## Features

- **`.env` → `JSON`** — Convert environment variable files to JSON
- **`JSON` → `.env`** — Convert JSON files to .env format
- **In-place conversion** — Replace content in the current editor
- **New file creation** — Save conversion result as a new file
- **Right-click menu** — Context menu support for quick access
- **Keyboard shortcuts** — Fast conversion with hotkeys

## Usage

### Command Palette

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and search for:

| Command | Description |
|---------|-------------|
| `Envify: Convert .env to JSON` | Replace current content with JSON |
| `Envify: Convert JSON to .env` | Replace current content with .env |
| `Envify: Convert .env to JSON (New File)` | Create a new .json file |
| `Envify: Convert JSON to .env (New File)` | Create a new .env file |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+J` / `Cmd+Shift+J` | Convert .env → JSON |
| `Ctrl+Alt+E` / `Cmd+Alt+E` | Convert JSON → .env |

### Right-Click Menu

Right-click in the editor to see Envify commands in the context menu. Commands appear based on the file type you're editing.

## Examples

### .env → JSON

**Before:**
```env
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=sk-1234567890
DEBUG=true
APP_NAME="My App"
```

**After:**
```json
{
  "DATABASE_URL": "postgres://localhost:5432/mydb",
  "API_KEY": "sk-1234567890",
  "DEBUG": "true",
  "APP_NAME": "My App"
}
```

### JSON → .env

**Before:**
```json
{
  "DATABASE_URL": "postgres://localhost:5432/mydb",
  "API_KEY": "sk-1234567890",
  "DEBUG": "true",
  "APP_NAME": "My App"
}
```

**After:**
```env
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=sk-1234567890
DEBUG=true
APP_NAME="My App"
```

## Supported Formats

- Handles quoted values (single and double quotes)
- Handles escape sequences (`\n`, `\t`, `\\`, `\"`)
- Skips comments and empty lines in .env files
- Nested JSON objects are stringified when converting to .env

## License

MIT
