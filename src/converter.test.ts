import * as assert from 'assert';
import {
  compareEnv,
  envToDockerCompose,
  envToExample,
  envToJson,
  envToKubernetesConfigMap,
  envToKubernetesSecret,
  envToShell,
  envToYaml,
  expandValue,
  formatEnv,
  inferType,
  jsonToEnv,
  lintEnv,
  parseEnv,
  parseEnvDocument,
  yamlScalar,
} from './converter';

let failures = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// --- parseEnv ---

section('parseEnv');

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

test('handles escaped double quote inside double quotes', () => {
  const result = parseEnv('FOO="say \\"hi\\""');
  assert.deepStrictEqual(result, { FOO: 'say "hi"' });
});

test('single-quoted values are literal (no escape processing)', () => {
  const result = parseEnv("FOO='a\\nb'");
  assert.deepStrictEqual(result, { FOO: 'a\\nb' });
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

test('supports export prefix', () => {
  const result = parseEnv('export FOO=bar\nexport  BAZ="qux"');
  assert.deepStrictEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('strips inline comments from unquoted values', () => {
  const result = parseEnv('FOO=bar # a comment\nBAZ=qux   #another');
  assert.deepStrictEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('keeps # inside unquoted values when not preceded by whitespace', () => {
  const result = parseEnv('COLOR=#ff0000\nTAG=a#b');
  assert.deepStrictEqual(result, { COLOR: '#ff0000', TAG: 'a#b' });
});

test('treats "KEY= # comment" as empty value but "KEY=#x" as a value', () => {
  assert.deepStrictEqual(parseEnv('FOO= # nothing'), { FOO: '' });
  assert.deepStrictEqual(parseEnv('FOO=#x'), { FOO: '#x' });
});

test('strips inline comments after quoted values', () => {
  const result = parseEnv('FOO="bar # not a comment" # real comment');
  assert.deepStrictEqual(result, { FOO: 'bar # not a comment' });
});

test('supports multi-line double-quoted values', () => {
  const content = 'KEY="-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----"\nNEXT=1';
  const result = parseEnv(content);
  assert.deepStrictEqual(result, { KEY: '-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----', NEXT: '1' });
});

test('supports multi-line single-quoted values', () => {
  const result = parseEnv("KEY='line1\nline2'\nNEXT=1");
  assert.deepStrictEqual(result, { KEY: 'line1\nline2', NEXT: '1' });
});

test('unclosed quote falls back to literal single-line value', () => {
  const result = parseEnv('FOO="unclosed\nBAR=ok');
  assert.deepStrictEqual(result, { FOO: '"unclosed', BAR: 'ok' });
});

test('later duplicate keys win', () => {
  const result = parseEnv('FOO=1\nFOO=2');
  assert.deepStrictEqual(result, { FOO: '2' });
});

test('does not expand variables by default', () => {
  const result = parseEnv('A=x\nB=${A}/y');
  assert.deepStrictEqual(result, { A: 'x', B: '${A}/y' });
});

test('expands ${VAR} and $VAR when enabled', () => {
  const result = parseEnv('A=x\nB=${A}/y\nC=$A-z', { expandVariables: true });
  assert.deepStrictEqual(result, { A: 'x', B: 'x/y', C: 'x-z' });
});

test('expansion works regardless of definition order', () => {
  const result = parseEnv('B=${A}!\nA=x', { expandVariables: true });
  assert.deepStrictEqual(result, { B: 'x!', A: 'x' });
});

test('expansion supports defaults and escaped dollar', () => {
  const result = parseEnv('A=\nB=${A:-fallback}\nC=${A-other}\nD=${MISSING:-dflt}\nE="\\$notavar"\nF=${MISSING}', {
    expandVariables: true,
  });
  assert.deepStrictEqual(result, { A: '', B: 'fallback', C: '', D: 'dflt', E: '$notavar', F: '' });
});

test('expansion skips single-quoted values', () => {
  const result = parseEnv("A=x\nB='${A}'", { expandVariables: true });
  assert.deepStrictEqual(result, { A: 'x', B: '${A}' });
});

test('expansion survives cycles', () => {
  const result = parseEnv('A=${B}\nB=${A}', { expandVariables: true });
  assert.deepStrictEqual(result, { A: '', B: '' });
});

// --- parseEnvDocument ---

section('parseEnvDocument');

test('classifies lines and records positions', () => {
  const doc = parseEnvDocument('# c\n\nexport FOO = "bar" # hi\nbad line\n');
  assert.deepStrictEqual(doc.lines.map((l) => l.type), ['comment', 'blank', 'entry', 'invalid', 'blank']);
  const entry = doc.lines[2];
  assert.strictEqual(entry.key, 'FOO');
  assert.strictEqual(entry.value, 'bar');
  assert.strictEqual(entry.rawValue, '"bar"');
  assert.strictEqual(entry.quote, '"');
  assert.strictEqual(entry.exported, true);
  assert.strictEqual(entry.inlineComment, '# hi');
  assert.strictEqual(entry.keyStart, 7);
  assert.strictEqual(entry.keyEnd, 10);
  assert.strictEqual(entry.valueStart, 13);
  assert.strictEqual(entry.valueEnd, 18);
  assert.match(doc.lines[3].reason as string, /Missing '='/);
});

test('multi-line entries span the right lines', () => {
  const doc = parseEnvDocument('A="1\n2"\nB=3');
  assert.strictEqual(doc.lines.length, 2);
  assert.strictEqual(doc.lines[0].line, 0);
  assert.strictEqual(doc.lines[0].endLine, 1);
  assert.strictEqual(doc.lines[1].line, 2);
});

// --- expandValue ---

section('expandValue');

test('expands with a custom lookup', () => {
  const lookup = (n: string) => ({ X: 'x' } as Record<string, string>)[n];
  assert.strictEqual(expandValue('${Y:-dflt}/${X}/$X', lookup), 'dflt/x/x');
});

// --- inferType ---

section('inferType');

test('infers booleans, null and numbers', () => {
  assert.strictEqual(inferType('true'), true);
  assert.strictEqual(inferType('false'), false);
  assert.strictEqual(inferType('null'), null);
  assert.strictEqual(inferType('3000'), 3000);
  assert.strictEqual(inferType('-1.5'), -1.5);
  assert.strictEqual(inferType('0'), 0);
});

test('keeps ambiguous strings as strings', () => {
  assert.strictEqual(inferType('007'), '007');
  assert.strictEqual(inferType('TRUE'), 'TRUE');
  assert.strictEqual(inferType('1e5'), '1e5');
  assert.strictEqual(inferType('12345678901234567890'), '12345678901234567890');
  assert.strictEqual(inferType(''), '');
});

// --- envToJson ---

section('envToJson');

test('converts env content to formatted JSON string', () => {
  const result = envToJson('FOO=bar\nBAZ=123');
  const parsed = JSON.parse(result);
  assert.deepStrictEqual(parsed, { FOO: 'bar', BAZ: '123' });
});

test('respects custom indent option', () => {
  const result = envToJson('FOO=bar', { indent: 4 });
  assert.ok(result.includes('    "FOO"'));
});

test('inferTypes only applies to unquoted values', () => {
  const result = JSON.parse(envToJson('PORT=3000\nDEBUG=true\nZIP="01234"\nNAME=\'true\'', { inferTypes: true }));
  assert.deepStrictEqual(result, { PORT: 3000, DEBUG: true, ZIP: '01234', NAME: 'true' });
});

test('nestedSeparator builds nested objects', () => {
  const result = JSON.parse(envToJson('DB__HOST=localhost\nDB__PORT=5432\nAPP=x\nTRAIL__=y', { nestedSeparator: '__' }));
  assert.deepStrictEqual(result, { DB: { HOST: 'localhost', PORT: '5432' }, APP: 'x', TRAIL__: 'y' });
});

test('sortKeys sorts recursively', () => {
  const result = envToJson('B__Z=1\nB__A=2\nA=3', { nestedSeparator: '__', sortKeys: true, indent: 0 });
  assert.strictEqual(result, '{"A":"3","B":{"A":"2","Z":"1"}}');
});

test('expandVariables resolves references in JSON output', () => {
  const result = JSON.parse(envToJson('HOST=db\nURL=postgres://${HOST}:5432', { expandVariables: true }));
  assert.deepStrictEqual(result, { HOST: 'db', URL: 'postgres://db:5432' });
});

// --- jsonToEnv ---

section('jsonToEnv');

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

test('quotes values with leading or trailing whitespace', () => {
  assert.strictEqual(jsonToEnv('{"A":" x"}'), 'A=" x"');
});

test('stringifies nested objects', () => {
  const result = jsonToEnv('{"CONFIG":{"a":1}}');
  assert.strictEqual(result, "CONFIG='{\"a\":1}'");
});

test('nested objects containing single quotes use double quotes', () => {
  const result = jsonToEnv('{"CONFIG":{"a":"it\'s"}}');
  assert.strictEqual(result, 'CONFIG="{\\"a\\":\\"it\'s\\"}"');
  assert.deepStrictEqual(parseEnv(result), { CONFIG: '{"a":"it\'s"}' });
});

test('converts non-string primitives to string', () => {
  const result = jsonToEnv('{"PORT":3000,"DEBUG":true}');
  assert.strictEqual(result, 'PORT=3000\nDEBUG=true');
});

test('quoteStyle always wraps every value', () => {
  const result = jsonToEnv('{"A":"x","B":1,"C":{"k":"v"}}', { quoteStyle: 'always' });
  assert.strictEqual(result, 'A="x"\nB="1"\nC="{\\"k\\":\\"v\\"}"');
});

test('nestedSeparator flattens nested objects', () => {
  const result = jsonToEnv('{"DB":{"HOST":"h","PORT":1},"LIST":[1,2]}', { nestedSeparator: '__' });
  assert.strictEqual(result, "DB__HOST=h\nDB__PORT=1\nLIST='[1,2]'");
});

test('sortKeys sorts output lines', () => {
  const result = jsonToEnv('{"B":"1","A":"2"}', { sortKeys: true });
  assert.strictEqual(result, 'A=2\nB=1');
});

test('throws on invalid key names', () => {
  assert.throws(() => jsonToEnv('{"invalid key":"value"}'), /Invalid .env key/);
  assert.throws(() => jsonToEnv('{"123bad":"value"}'), /Invalid .env key/);
});

test('throws on invalid flattened key names', () => {
  assert.throws(() => jsonToEnv('{"db":{"host-name":"x"}}', { nestedSeparator: '__' }), /Invalid .env key/);
});

test('throws on arrays', () => {
  assert.throws(() => jsonToEnv('[1,2,3]'), /flat object/);
});

test('throws on non-object JSON', () => {
  assert.throws(() => jsonToEnv('"hello"'), /flat object/);
});

// --- formatEnv ---

section('formatEnv');

test('trims whitespace around = and trailing whitespace', () => {
  assert.strictEqual(formatEnv('FOO = bar   \nBAZ=qux'), 'FOO=bar\nBAZ=qux\n');
});

test('collapses blank lines and ensures single trailing newline', () => {
  assert.strictEqual(formatEnv('A=1\n\n\n\nB=2\n\n\n'), 'A=1\n\nB=2\n');
});

test('preserves comments, export prefix, quotes and inline comments', () => {
  const input = '# head\nexport FOO = "a b"  # note\nBAR=\'x\'\n';
  assert.strictEqual(formatEnv(input), '# head\nexport FOO="a b" # note\nBAR=\'x\'\n');
});

test('preserves multi-line quoted values', () => {
  const input = 'KEY="line1\nline2 = x"\nNEXT = 1\n';
  assert.strictEqual(formatEnv(input), 'KEY="line1\nline2 = x"\nNEXT=1\n');
});

test('keeps invalid lines untouched apart from trimming', () => {
  assert.strictEqual(formatEnv('  not a pair  \nA=1'), 'not a pair\nA=1\n');
});

// --- envToExample ---

section('envToExample');

test('blanks values but keeps keys, comments and layout', () => {
  const input = '# Database\nDB_URL=postgres://secret\n\nexport API_KEY="sk-123" # keep me\n';
  assert.strictEqual(envToExample(input), '# Database\nDB_URL=\n\nexport API_KEY= # keep me\n');
});

test('supports a placeholder', () => {
  assert.strictEqual(envToExample('A=1\nB=2', { placeholder: 'changeme' }), 'A=changeme\nB=changeme\n');
});

test('collapses multi-line values to a single line', () => {
  assert.strictEqual(envToExample('KEY="a\nb"\nX=1'), 'KEY=\nX=\n');
});

// --- compareEnv ---

section('compareEnv');

test('reports missing, extra and empty keys', () => {
  const env = 'A=1\nB=\nD=4';
  const example = 'A=\nB=\nC=';
  assert.deepStrictEqual(compareEnv(env, example), { missing: ['C'], extra: ['D'], empty: ['B'] });
});

test('reports nothing when in sync', () => {
  assert.deepStrictEqual(compareEnv('A=1\nB=2', 'A=\nB='), { missing: [], extra: [], empty: [] });
});

// --- lintEnv ---

section('lintEnv');

test('reports invalid lines as errors', () => {
  const issues = lintEnv('A=1\nnope\n1BAD=x\n=y');
  assert.deepStrictEqual(
    issues.map((i) => [i.code, i.severity, i.line]),
    [
      ['invalid-line', 'error', 1],
      ['invalid-line', 'error', 2],
      ['invalid-line', 'error', 3],
    ]
  );
  assert.match(issues[0].message, /Missing '='/);
  assert.match(issues[1].message, /Invalid key name "1BAD"/);
  assert.match(issues[2].message, /Missing key name/);
});

test('reports duplicate keys with related location', () => {
  const issues = lintEnv('A=1\nB=2\nA=3');
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].code, 'duplicate-key');
  assert.strictEqual(issues[0].line, 2);
  assert.deepStrictEqual([issues[0].startCol, issues[0].endCol], [0, 1]);
  assert.strictEqual(issues[0].related?.line, 0);
});

test('reports unquoted values containing whitespace', () => {
  const issues = lintEnv('A=hello world\nB="hello world"');
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].code, 'unquoted-spaces');
  assert.deepStrictEqual([issues[0].startCol, issues[0].endCol], [2, 13]);
});

test('reports unclosed quotes', () => {
  const issues = lintEnv('A="oops');
  assert.strictEqual(issues[0].code, 'unclosed-quote');
});

test('reports undefined references as hints, ignoring single-quoted values', () => {
  const issues = lintEnv("A=${Z}\nC='${Z}'\nD=\\$Z\nB=1\nE=${B}");
  assert.deepStrictEqual(
    issues.map((i) => [i.code, i.line]),
    [['undefined-reference', 0]]
  );
  assert.strictEqual(issues[0].severity, 'hint');
});

test('clean file has no issues', () => {
  assert.deepStrictEqual(lintEnv('# c\nA=1\nB="x y"\n'), []);
});

// --- other formats ---

section('other formats');

test('envToShell single-quotes and escapes values', () => {
  assert.strictEqual(envToShell("A=x\nB=it's # c\nC=\"a b\""), "export A='x'\nexport B='it'\\''s'\nexport C='a b'\n");
});

test('yamlScalar quotes ambiguous values', () => {
  assert.strictEqual(yamlScalar('abc'), 'abc');
  assert.strictEqual(yamlScalar('postgres://h:5432/db'), 'postgres://h:5432/db');
  assert.strictEqual(yamlScalar('true'), '"true"');
  assert.strictEqual(yamlScalar('3000'), '"3000"');
  assert.strictEqual(yamlScalar('a b'), '"a b"');
  assert.strictEqual(yamlScalar(''), '""');
  assert.strictEqual(yamlScalar('key: v'), '"key: v"');
  assert.strictEqual(yamlScalar('#fff'), '"#fff"');
  assert.strictEqual(yamlScalar('a\nb'), '"a\\nb"');
});

test('envToYaml produces a flat mapping', () => {
  assert.strictEqual(envToYaml('A=x\nPORT=80'), 'A: x\nPORT: "80"\n');
  assert.strictEqual(envToYaml(''), '{}\n');
});

test('envToDockerCompose produces environment block', () => {
  assert.strictEqual(envToDockerCompose('A=x'), 'environment:\n  A: x\n');
});

test('envToKubernetesConfigMap quotes every value', () => {
  const out = envToKubernetesConfigMap('A=x\nPORT=80', { name: 'cfg', namespace: 'ns' });
  assert.strictEqual(out, 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n  namespace: ns\ndata:\n  A: "x"\n  PORT: "80"\n');
});

test('envToKubernetesSecret base64-encodes values', () => {
  const out = envToKubernetesSecret('A=hello\nB=ทดสอบ', { name: 's' });
  assert.strictEqual(
    out,
    'apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\ntype: Opaque\ndata:\n  A: aGVsbG8=\n  B: 4LiX4LiU4Liq4Lit4Lia\n'
  );
});

// --- round-trip ---

section('round-trip');

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

test('nested json → env → json round-trips with separator', () => {
  const original = { DB: { HOST: 'h', PORT: 5432 }, DEBUG: true, NAME: 'My App' };
  const env = jsonToEnv(JSON.stringify(original), { nestedSeparator: '__' });
  const back = JSON.parse(envToJson(env, { nestedSeparator: '__', inferTypes: true }));
  assert.deepStrictEqual(back, original);
});

test('tricky values survive env → json → env → json', () => {
  const values = {
    QUOTES: 'he said "hi" and \'bye\'',
    BACKSLASH: 'C:\\path\\new',
    MULTI: 'line1\nline2',
    HASH: '#ff0000',
    SPACES: '  padded  ',
    EMPTY: '',
    DOLLAR: '${NOT_EXPANDED}',
  };
  const env = jsonToEnv(JSON.stringify(values));
  assert.deepStrictEqual(JSON.parse(envToJson(env)), values);
});

test('formatEnv is idempotent', () => {
  const messy = '# c\n\n\nexport A = "x y" # n\nB=\'q\'\n\nC="m\nn"\n\n';
  const once = formatEnv(messy);
  assert.strictEqual(formatEnv(once), once);
});

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
