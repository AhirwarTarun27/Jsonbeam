import { describe, it, expect } from 'vitest';
import { jsonToCsv } from '../src/lib/convert-csv';
import { jsonToYaml } from '../src/lib/convert-yaml';
import { inferSchema } from '../src/lib/infer';
import { emitTypeScript } from '../src/lib/emit-typescript';
import { emitGo } from '../src/lib/emit-go';

// ── CSV ──────────────────────────────────────────────────────────────────────

describe('jsonToCsv', () => {
	it('renders an array of objects with a header and union of keys', () => {
		const r = jsonToCsv([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
		expect(r.headers).toEqual(['a', 'b', 'c']);
		expect(r.rows).toEqual([
			['1', '2', ''],
			['3', '', '4'],
		]);
		expect(r.csv).toBe('a,b,c\n1,2,\n3,,4');
	});

	it('flattens nested objects with dot notation', () => {
		const r = jsonToCsv([{ user: { name: 'Ada', city: 'London' } }], { flatten: true });
		expect(r.headers).toEqual(['user.name', 'user.city']);
		expect(r.rows[0]).toEqual(['Ada', 'London']);
	});

	it('keeps nested objects as JSON when flatten is off', () => {
		const r = jsonToCsv([{ user: { name: 'Ada' } }], { flatten: false });
		expect(r.headers).toEqual(['user']);
		expect(r.rows[0]).toEqual(['{"name":"Ada"}']);
	});

	it('handles arrays via join / json / columns modes', () => {
		expect(jsonToCsv([{ tags: ['x', 'y'] }], { arrayMode: 'join', arraySeparator: '|' }).rows[0]).toEqual(['x|y']);
		expect(jsonToCsv([{ tags: ['x', 'y'] }], { arrayMode: 'json' }).rows[0]).toEqual(['["x","y"]']);
		const cols = jsonToCsv([{ tags: ['x', 'y'] }], { arrayMode: 'columns' });
		expect(cols.headers).toEqual(['tags.0', 'tags.1']);
		expect(cols.rows[0]).toEqual(['x', 'y']);
	});

	it('quotes cells per RFC 4180 and supports custom delimiters', () => {
		const r = jsonToCsv([{ note: 'a,b"c\nd' }]);
		expect(r.csv).toBe('note\n"a,b""c\nd"');
		const semi = jsonToCsv([{ a: 1, b: 2 }], { delimiter: ';' });
		expect(semi.csv).toBe('a;b\n1;2');
	});

	it('treats a single object as one row and null per nullValue', () => {
		const r = jsonToCsv({ a: null, b: 2 }, { nullValue: 'NULL' });
		expect(r.csv).toBe('a,b\nNULL,2');
	});

	it('does not touch formula-like cells by default', () => {
		expect(jsonToCsv([{ a: '=SUM(A1)' }]).csv).toBe('a\n=SUM(A1)');
	});

	it('escapes formula cells (but not plain numbers) when formulaGuard is on', () => {
		const r = jsonToCsv([{ a: '=SUM(A1)', b: -5, c: '-1+2', d: '@cmd' }], { formulaGuard: true });
		expect(r.csv).toBe("a,b,c,d\n'=SUM(A1),-5,'-1+2,'@cmd");
		// The preview grid stays faithful to the source — only the CSV text is sanitized.
		expect(r.rows[0]).toEqual(['=SUM(A1)', '-5', '-1+2', '@cmd']);
	});
});

// ── YAML ─────────────────────────────────────────────────────────────────────

describe('jsonToYaml', () => {
	it('emits a simple mapping', () => {
		expect(jsonToYaml({ name: 'Ada', age: 36 })).toBe('name: Ada\nage: 36\n');
	});

	it('emits arrays of objects with the dash-merged layout', () => {
		const yaml = jsonToYaml({ users: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
		expect(yaml).toBe(
			'users:\n  - id: 1\n    name: A\n  - id: 2\n    name: B\n',
		);
	});

	it('quotes strings only when a plain scalar would be misread', () => {
		expect(jsonToYaml({ a: 'true', b: 'hello world', c: '123', d: 'a: b' })).toBe(
			"a: 'true'\nb: hello world\nc: '123'\nd: 'a: b'\n",
		);
	});

	it('uses a literal block scalar for clean multiline strings', () => {
		expect(jsonToYaml({ desc: 'line one\nline two' })).toBe('desc: |-\n  line one\n  line two\n');
	});

	it('falls back to double quotes for multiline with trailing space', () => {
		expect(jsonToYaml({ desc: 'a \nb' })).toBe('desc: "a \\nb"\n');
	});

	it('renders empty containers inline and honors options', () => {
		expect(jsonToYaml({ a: {}, b: [] })).toBe('a: {}\nb: []\n');
		expect(jsonToYaml({ b: 1, a: 2 }, { sortKeys: true })).toBe('a: 2\nb: 1\n');
		expect(jsonToYaml({ a: 1 }, { documentStart: true })).toBe('---\na: 1\n');
		expect(jsonToYaml({ a: 1 }, { indent: 4 })).toBe('a: 1\n');
		expect(jsonToYaml({ a: { b: 1 } }, { indent: 4 })).toBe('a:\n    b: 1\n');
	});
});

// ── TypeScript ───────────────────────────────────────────────────────────────

describe('emitTypeScript', () => {
	it('generates an interface for a plain object', () => {
		const ts = emitTypeScript(inferSchema({ id: 1, name: 'A', active: true }));
		expect(ts).toBe(
			'export interface Root {\n  id: number;\n  name: string;\n  active: boolean;\n}\n',
		);
	});

	it('infers optional fields across array elements', () => {
		const ts = emitTypeScript(inferSchema([{ a: 1, b: 2 }, { a: 1 }]));
		expect(ts).toContain('b?: number;');
		expect(ts).toContain('type Root = RootItem[];');
	});

	it('infers nullable and union types', () => {
		const ts = emitTypeScript(inferSchema([{ x: 1 }, { x: null }, { x: 'hi' }]));
		expect(ts).toMatch(/x\??: (number \| string \| null|string \| number \| null);/);
	});

	it('names and de-duplicates nested interfaces', () => {
		const ts = emitTypeScript(inferSchema({ a: { v: 1 }, b: { v: 2 } }));
		// Both nested objects share a structure → one interface, referenced twice.
		expect(ts).toContain('interface Root');
		const ifaceCount = (ts.match(/interface /g) ?? []).length;
		expect(ifaceCount).toBe(2);
	});

	it('produces string-literal unions when enums are enabled', () => {
		const ts = emitTypeScript(inferSchema([{ s: 'a' }, { s: 'b' }, { s: 'a' }]), { enums: true });
		expect(ts).toMatch(/s: "a" \| "b";/);
	});

	it('honors declaration / optionalStyle / readonly options', () => {
		const ts = emitTypeScript(inferSchema({ a: 1 }), {
			declaration: 'type',
			useReadonly: true,
			export: false,
		});
		expect(ts).toBe('type Root = {\n  readonly a: number;\n};\n');
	});
});

// ── Go ───────────────────────────────────────────────────────────────────────

describe('emitGo', () => {
	it('generates a struct with json tags and aligned columns', () => {
		const go = emitGo(inferSchema({ id: 1, name: 'A' }));
		expect(go).toBe(
			'type Root struct {\n\tID   int    `json:"id"`\n\tName string `json:"name"`\n}\n',
		);
	});

	it('upper-cases initialisms in field names', () => {
		const go = emitGo(inferSchema({ userId: 1, apiURL: 'x' }));
		expect(go).toContain('UserID');
		expect(go).toContain('APIURL');
	});

	it('uses pointers for nullable / optional fields', () => {
		const go = emitGo(inferSchema([{ a: 1, b: 2 }, { a: 1 }]));
		expect(go).toContain('*int');
		expect(go).toContain('type Root []RootItem');
	});

	it('distinguishes int from float and detects time.Time', () => {
		const go = emitGo(inferSchema({ n: 3, f: 1.5, when: '2024-01-02T03:04:05Z' }));
		expect(go).toContain('import "time"');
		expect(go).toContain('time.Time');
		expect(go).toMatch(/\tN +int\b/);
		expect(go).toContain('float64');
	});

	it('honors int64 and omitempty options', () => {
		const go = emitGo(inferSchema([{ a: 1 }, {}]), { intType: 'int64', omitempty: true });
		expect(go).toContain('int64');
		expect(go).toContain(',omitempty');
	});

	it('disambiguates fields that collapse to the same Go name', () => {
		// `user-id` and `user_id` both export to `UserID` — must stay compilable.
		const go = emitGo(inferSchema({ 'user-id': 1, 'user_id': 2 }));
		expect(go).toContain('UserID');
		expect(go).toContain('UserID2');
		expect(go).toContain('`json:"user-id"`');
		expect(go).toContain('`json:"user_id"`');
	});
});
