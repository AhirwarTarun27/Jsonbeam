import { describe, it, expect } from 'vitest';
import { runEngineOp } from '../src/lib/json-engine-core';

describe('json-engine-core · runEngineOp', () => {
	it('formats with a numeric indent', () => {
		const r = runEngineOp({ op: 'format', text: '{"b":2,"a":1}', space: 2 });
		expect(r).toEqual({ ok: true, result: '{\n  "b": 2,\n  "a": 1\n}' });
	});

	it('formats with a tab indent', () => {
		const r = runEngineOp({ op: 'format', text: '[1,2]', space: '\t' });
		expect(r).toEqual({ ok: true, result: '[\n\t1,\n\t2\n]' });
	});

	it('minifies (no whitespace)', () => {
		const r = runEngineOp({ op: 'minify', text: '{\n  "a": [1, 2, 3]\n}' });
		expect(r).toEqual({ ok: true, result: '{"a":[1,2,3]}' });
	});

	it('round-trips: minify(format(x)) === minify(x)', () => {
		const src = '{"items":[{"id":0,"name":"row-0"},{"id":1,"name":"row-1"}]}';
		const formatted = runEngineOp({ op: 'format', text: src, space: 2 });
		expect(formatted.ok).toBe(true);
		const minified = runEngineOp({ op: 'minify', text: (formatted as { result: string }).result });
		expect(minified).toEqual({ ok: true, result: src });
	});

	it('returns a tagged error (never throws) on invalid JSON', () => {
		const r = runEngineOp({ op: 'format', text: '{bad', space: 2 });
		expect(r.ok).toBe(false);
		expect((r as { error: string }).error).toMatch(/JSON|token|Unexpected/i);
	});

	it('handles a large payload without throwing', () => {
		const big = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, i) => ({ id: i })) });
		const r = runEngineOp({ op: 'minify', text: big });
		expect(r.ok).toBe(true);
		expect((r as { result: string }).result).toBe(big);
	});
});
