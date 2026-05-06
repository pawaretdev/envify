# Changelog

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
