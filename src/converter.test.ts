import * as assert from 'assert';
import { parseEnv, envToJson, jsonToEnv } from './converter';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// --- parseEnv ---

console.log('parseEnv');

test('parses simple key=value pairs', () => {
  const result = parseEnv('FOO=bar\nBAZ=123');
  assert.deepStrictEqual(result, { FOO: 'bar', BAZ: '123' });
});

test('skips comments and empty lines', () => {
  const result = parseEnv('# comment\n\nFOO=bar\n  # another comment\nBAZ=qux');
  assert.deepStrictEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('handles double-quoted values', () => {
  const result = parseEnv('FOO="hello world"');
  assert.deepStrictEqual(result, { FOO: 'hello world' });
});

test('handles single-quoted values', () => {
  const result = parseEnv("FOO='hello world'");
  assert.deepStrictEqual(result, { FOO: 'hello world' });
});

test('handles escape sequences in double-quoted values', () => {
  const result = parseEnv('FOO="line1\\nline2\\ttab"');
  assert.deepStrictEqual(result, { FOO: 'line1\nline2\ttab' });
});

test('handles double backslash before n (\\\\n = literal backslash + n)', () => {
  const result = parseEnv('FOO="hello\\\\nworld"');
  assert.deepStrictEqual(result, { FOO: 'hello\\nworld' });
});

test('handles escaped backslash at end of value', () => {
  const result = parseEnv('FOO="trail\\\\"');
  assert.deepStrictEqual(result, { FOO: 'trail\\' });
});

test('handles values with equals signs', () => {
  const result = parseEnv('DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require');
  assert.deepStrictEqual(result, { DATABASE_URL: 'postgres://user:pass@host:5432/db?sslmode=require' });
});

test('handles empty values', () => {
  const result = parseEnv('FOO=');
  assert.deepStrictEqual(result, { FOO: '' });
});

test('handles spaces around equals', () => {
  const result = parseEnv('FOO = bar');
  assert.deepStrictEqual(result, { FOO: 'bar' });
});

test('skips invalid key names', () => {
  const result = parseEnv('123BAD=val\nGOOD_KEY=val');
  assert.deepStrictEqual(result, { GOOD_KEY: 'val' });
});

test('handles Windows line endings', () => {
  const result = parseEnv('FOO=bar\r\nBAZ=qux');
  assert.deepStrictEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

// --- envToJson ---

console.log('\nenvToJson');

test('converts env content to formatted JSON string', () => {
  const result = envToJson('FOO=bar\nBAZ=123');
  const parsed = JSON.parse(result);
  assert.deepStrictEqual(parsed, { FOO: 'bar', BAZ: '123' });
});

test('respects custom indent option', () => {
  const result = envToJson('FOO=bar', { indent: 4 });
  assert.ok(result.includes('    "FOO"'));
});

// --- jsonToEnv ---

console.log('\njsonToEnv');

test('converts flat JSON to env format', () => {
  const result = jsonToEnv('{"FOO":"bar","BAZ":"123"}');
  assert.strictEqual(result, 'FOO=bar\nBAZ=123');
});

test('quotes values with spaces', () => {
  const result = jsonToEnv('{"APP_NAME":"My App"}');
  assert.strictEqual(result, 'APP_NAME="My App"');
});

test('quotes values with special characters', () => {
  const result = jsonToEnv('{"VAL":"has#hash"}');
  assert.strictEqual(result, 'VAL="has#hash"');
});

test('escapes newlines and tabs in values', () => {
  const result = jsonToEnv('{"VAL":"line1\\nline2"}');
  assert.strictEqual(result, 'VAL="line1\\nline2"');
});

test('quotes empty values', () => {
  const result = jsonToEnv('{"EMPTY":""}');
  assert.strictEqual(result, 'EMPTY=""');
});

test('stringifies nested objects', () => {
  const result = jsonToEnv('{"CONFIG":{"a":1}}');
  assert.strictEqual(result, "CONFIG='{\"a\":1}'");
});

test('converts non-string primitives to string', () => {
  const result = jsonToEnv('{"PORT":3000,"DEBUG":true}');
  assert.strictEqual(result, 'PORT=3000\nDEBUG=true');
});

test('throws on invalid key names', () => {
  assert.throws(() => jsonToEnv('{"invalid key":"value"}'), /Invalid .env key/);
  assert.throws(() => jsonToEnv('{"123bad":"value"}'), /Invalid .env key/);
});

test('throws on arrays', () => {
  assert.throws(() => jsonToEnv('[1,2,3]'), /flat object/);
});

test('throws on non-object JSON', () => {
  assert.throws(() => jsonToEnv('"hello"'), /flat object/);
});

// --- round-trip ---

console.log('\nround-trip');

test('env → json → env preserves data', () => {
  const original = 'DATABASE_URL=postgres://localhost:5432/db\nAPI_KEY=sk-1234\nDEBUG=true';
  const json = envToJson(original);
  const backToEnv = jsonToEnv(json);
  assert.strictEqual(backToEnv, original);
});

test('json → env → json preserves data', () => {
  const original = '{\n  "FOO": "bar",\n  "BAZ": "123"\n}';
  const env = jsonToEnv(original);
  const backToJson = envToJson(env);
  assert.strictEqual(backToJson, original);
});

console.log('\nAll tests completed.');
