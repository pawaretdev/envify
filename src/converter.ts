/**
 * Core conversion logic for Envify
 */

export interface ConvertOptions {
  /** Indent size for JSON output (default: 2) */
  indent?: number;
}

/**
 * Parse .env content into a key-value object
 */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match KEY=VALUE pattern
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)/);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2];

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle escape sequences in double-quoted values (single-pass to handle \\ correctly)
    if (match[2].startsWith('"')) {
      value = value.replace(/\\(.)/g, (_, c) => {
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

    result[key] = value;
  }

  return result;
}

/**
 * Convert .env content string to JSON string
 */
export function envToJson(content: string, options: ConvertOptions = {}): string {
  const { indent = 2 } = options;
  const parsed = parseEnv(content);
  return JSON.stringify(parsed, null, indent);
}

/**
 * Convert JSON string to .env content string
 */
export function jsonToEnv(content: string): string {
  const parsed = JSON.parse(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON must be a flat object with string values');
  }

  const lines: string[] = [];
  const validKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  for (const [key, value] of Object.entries(parsed)) {
    if (!validKeyPattern.test(key)) {
      throw new Error(`Invalid .env key: "${key}". Keys must start with a letter or underscore and contain only letters, digits, and underscores.`);
    }
    if (typeof value === 'object' && value !== null) {
      // Nested objects — stringify them
      lines.push(`${key}='${JSON.stringify(value)}'`);
    } else {
      const strValue = String(value);

      // Quote values that contain spaces, special chars, or are empty
      if (
        strValue === '' ||
        strValue.includes(' ') ||
        strValue.includes('#') ||
        strValue.includes('"') ||
        strValue.includes("'") ||
        strValue.includes('\n')
      ) {
        const escaped = strValue
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        lines.push(`${key}="${escaped}"`);
      } else {
        lines.push(`${key}=${strValue}`);
      }
    }
  }

  return lines.join('\n');
}
