import { describe, it, expect } from 'vitest';
import { runJq } from '../src/lib/jq';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** All output values for a filter; throws if the filter errored. */
function vals(input: unknown, expr: string): unknown[] {
	const r = runJq(input, expr);
	if (!r.ok) throw new Error(`jq error for \`${expr}\`: ${r.error}`);
	return r.values;
}

/** The single output value; throws if the filter produced ≠ 1 value. */
function one(input: unknown, expr: string): unknown {
	const v = vals(input, expr);
	if (v.length !== 1) throw new Error(`expected 1 value from \`${expr}\`, got ${v.length}`);
	return v[0];
}

/** The error message of a filter that is expected to fail. */
function errOf(input: unknown, expr: string): string {
	const r = runJq(input, expr);
	if (r.ok) throw new Error(`expected \`${expr}\` to error, got ${JSON.stringify(r.values)}`);
	return r.error;
}

// ─────────────────────────────────────────────────────────────────────────────
//  C1 — $-variable bindings (tokenizer/parser were double-consuming the name)
// ─────────────────────────────────────────────────────────────────────────────

describe('jq · variable bindings (C1 regression)', () => {
	it('binds and references a simple variable', () => {
		expect(one(5, '. as $x | $x + 1')).toBe(6);
	});

	it('binds multiple variables across pipes', () => {
		expect(one({ a: 1, b: 2 }, '.a as $x | .b as $y | $x + $y')).toBe(3);
	});

	it('binds a variable to a literal', () => {
		expect(one(null, '5 as $x | $x * 2')).toBe(10);
	});

	it('runs reduce with an as-binding', () => {
		expect(one([1, 2, 3, 4], 'reduce .[] as $x (0; . + $x)')).toBe(10);
	});

	it('runs the snippet-library "Reduce sum" card', () => {
		const doc = { store: { books: [{ price: 10 }, { price: 20.5 }, { price: 4.5 }] } };
		expect(one(doc, 'reduce .store.books[] as $b (0; . + $b.price)')).toBe(35);
	});

	it('runs foreach, yielding each accumulator step', () => {
		expect(vals([1, 2, 3], 'foreach .[] as $x (0; . + $x)')).toEqual([1, 3, 6]);
	});

	it('runs foreach with an extract expression', () => {
		expect(vals([1, 2, 3], 'foreach .[] as $x (0; . + $x; . * 10)')).toEqual([10, 30, 60]);
	});

	it('supports {$x} object shorthand from a binding', () => {
		expect(one(null, '5 as $x | {$x}')).toEqual({ x: 5 });
	});

	it('supports computed keys from a bound variable', () => {
		expect(one(null, '"name" as $k | {($k): 1}')).toEqual({ name: 1 });
	});

	it('supports value parameters in user functions', () => {
		expect(one(1, 'def addv($x): . + $x; addv(10)')).toBe(11);
	});

	it('supports filter parameters in user functions', () => {
		expect(vals(5, 'def twice(g): g, g; twice(. + 1)')).toEqual([6, 6]);
	});

	it('supports recursive user functions with value params', () => {
		expect(one(null, 'def fib($n): if $n < 2 then $n else fib($n - 1) + fib($n - 2) end; fib(10)')).toBe(55);
	});

	it('supports label / break early-exit', () => {
		expect(
			vals([1, 2, 3, 4], 'label $out | .[] | if . == 3 then break $out else . end'),
		).toEqual([1, 2]);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
//  C2 — multi-arity builtins (were shadowed by a flat, name-only registry)
// ─────────────────────────────────────────────────────────────────────────────

describe('jq · range (arity dispatch, C2 regression)', () => {
	it('range/1', () => {
		expect(one(null, '[range(3)]')).toEqual([0, 1, 2]);
	});
	it('range/2', () => {
		expect(one(null, '[range(2; 5)]')).toEqual([2, 3, 4]);
	});
	it('range/3 honors the step (was silently ignored)', () => {
		expect(one(null, '[range(0; 6; 2)]')).toEqual([0, 2, 4]);
	});
	it('range/3 counts down with a negative step', () => {
		expect(one(null, '[range(5; 0; -1)]')).toEqual([5, 4, 3, 2, 1]);
	});
});

describe('jq · any / all (arity dispatch, C2 regression)', () => {
	it('any/0 and all/0', () => {
		expect(one([false, false, true], 'any')).toBe(true);
		expect(one([false, false, false], 'any')).toBe(false);
		expect(one([true, true], 'all')).toBe(true);
		expect(one([true, false], 'all')).toBe(false);
	});
	it('any/1 and all/1', () => {
		expect(one([1, 2, 3], 'any(. > 2)')).toBe(true);
		expect(one([1, 2, 3], 'all(. > 0)')).toBe(true);
		expect(one([1, 2, 3], 'all(. > 1)')).toBe(false);
	});
	it('any/2 and all/2', () => {
		expect(one(null, 'any(1, 2, 3; . > 2)')).toBe(true);
		expect(one(null, 'all(1, 2, 3; . > 0)')).toBe(true);
	});
});

describe('jq · first / last / nth (arity dispatch, C2 regression)', () => {
	it('first/0 and last/0 act like .[0] / .[-1]', () => {
		expect(one([1, 2, 3], 'first')).toBe(1);
		expect(one([1, 2, 3], 'last')).toBe(3);
		expect(one([], 'first')).toBe(null);
		expect(one([], 'last')).toBe(null);
	});
	it('first/1 and last/1 take a generator', () => {
		expect(one(null, 'first(range(10))')).toBe(0);
		expect(one(null, 'last(range(1; 5))')).toBe(4);
	});
	it('nth/1 indexes an array, nth/2 indexes a generator', () => {
		expect(one([10, 20, 30], 'nth(1)')).toBe(20);
		expect(one(null, 'nth(2; range(100))')).toBe(2);
	});
});

describe('jq · paths / recurse / limit / flatten (arity dispatch, C2 regression)', () => {
	it('paths/0 yields every path (was empty / shadowed)', () => {
		expect(one({ a: { b: 1 }, c: 2 }, '[paths] | length')).toBe(3);
		expect(one({ a: { b: 1 }, c: 2 }, '[paths]')).toEqual([['a'], ['a', 'b'], ['c']]);
	});
	it('leaf_paths yields only leaf paths', () => {
		expect(one({ a: { b: 1 }, c: 2 }, '[leaf_paths]')).toEqual([['a', 'b'], ['c']]);
	});
	it('paths/1 filters by node predicate', () => {
		expect(one({ a: 1, b: 'x', c: 2 }, '[paths(type == "number")]')).toEqual([['a'], ['c']]);
	});
	it('recurse/0 walks the whole tree', () => {
		expect(one({ a: { b: 1 } }, '[recurse] | length')).toBe(3);
	});
	it('recurse/1 follows a generator until empty', () => {
		expect(one(0, '[recurse(if . < 3 then . + 1 else empty end)]')).toEqual([0, 1, 2, 3]);
	});
	it('limit/2 caps a generator', () => {
		expect(one(null, '[limit(2; range(10))]')).toEqual([0, 1]);
	});
	it('flatten/0 and flatten/1', () => {
		expect(one([[1, [2]], [3]], 'flatten')).toEqual([1, 2, 3]);
		expect(one([[1, [2]], [3]], 'flatten(1)')).toEqual([1, [2], 3]);
	});
});

describe('jq · regex builtins (test/match/scan single-pattern no longer shadowed)', () => {
	it('test/1 (single pattern)', () => {
		expect(one('abc', 'test("b")')).toBe(true);
		expect(one('abc', 'test("z")')).toBe(false);
	});
	it('test/2 (with flags)', () => {
		expect(one('ABC', 'test("abc"; "i")')).toBe(true);
	});
	it('match/1 returns the match object', () => {
		expect(one('abc123', 'match("[0-9]+") | .string')).toBe('123');
	});
	it('scan/1 finds all occurrences', () => {
		expect(one('a1b2c3', '[scan("[0-9]")]')).toEqual(['1', '2', '3']);
	});
	it('sub/2 and gsub/2', () => {
		expect(one('hello', 'sub("l"; "L")')).toBe('heLlo');
		expect(one('hello', 'gsub("l"; "L")')).toBe('heLLo');
	});
	it('rejects catastrophic (nested-quantifier) patterns instead of freezing', () => {
		// (a+)+$ against a long non-matching string is the classic ReDoS hang.
		expect(errOf('aaaaaaaaaaaaaaaaaaaaaaaa!', 'test("(a+)+$")')).toMatch(/catastrophic|not a valid regex/);
		expect(errOf('x', 'match("(.*)*$")')).toMatch(/catastrophic|not a valid regex/);
	});
	it('still accepts ordinary patterns with a single quantifier', () => {
		expect(one('aaa', 'test("a+")')).toBe(true);
		expect(one('a1b2', '[scan("[a-z][0-9]")]')).toEqual(['a1', 'b2']);
	});
	it('surfaces a jq-style error for an invalid regex (no raw exception)', () => {
		expect(errOf('x', 'test("(")')).toMatch(/not a valid regex/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
//  Regression guard — core jq that already worked must keep working
// ─────────────────────────────────────────────────────────────────────────────

describe('jq · core (regression guard)', () => {
	it('field access, iteration, indexing, slices', () => {
		expect(one({ a: 1 }, '.a')).toBe(1);
		expect(vals({ a: [1, 2] }, '.a[]')).toEqual([1, 2]);
		expect(one([10, 20, 30], '.[1]')).toBe(20);
		expect(one([10, 20, 30], '.[-1]')).toBe(30);
		expect(one([1, 2, 3, 4], '.[1:3]')).toEqual([2, 3]);
	});

	it('pipe, comma, and alternative', () => {
		expect(vals({ a: 1, b: 2 }, '.a, .b')).toEqual([1, 2]);
		expect(one({ a: 1 }, '.a // 99')).toBe(1);
		expect(one({ a: null }, '.a // 99')).toBe(99);
		expect(one({}, '.missing // "fallback"')).toBe('fallback');
	});

	it('arithmetic and comparison', () => {
		expect(one(null, '2 + 3 * 4')).toBe(14);
		expect(one(null, '10 / 4')).toBe(2.5);
		expect(one(null, '10 % 3')).toBe(1);
		expect(one(null, '1 < 2 and 2 < 3')).toBe(true);
	});

	it('map / select / sort / unique / group_by', () => {
		expect(one([{ x: 1 }, { x: 2 }], 'map(.x)')).toEqual([1, 2]);
		expect(one([1, 2, 3, 4], 'map(select(. % 2 == 0))')).toEqual([2, 4]);
		expect(one([3, 1, 2], 'sort')).toEqual([1, 2, 3]);
		expect(one([1, 2, 2, 3], 'unique')).toEqual([1, 2, 3]);
		expect(one([{ k: 'a' }, { k: 'b' }, { k: 'a' }], 'group_by(.k) | length')).toBe(2);
		expect(one([{ p: 3 }, { p: 1 }], 'sort_by(.p) | map(.p)')).toEqual([1, 3]);
	});

	it('object construction and to_entries / from_entries', () => {
		expect(one({ a: 1, b: 2 }, '{first: .a, second: .b}')).toEqual({ first: 1, second: 2 });
		expect(one({ a: 1, b: 2 }, 'to_entries | length')).toBe(2);
		expect(one([{ key: 'a', value: 1 }], 'from_entries')).toEqual({ a: 1 });
	});

	it('add, keys, length, has', () => {
		expect(one([1, 2, 3], 'add')).toBe(6);
		expect(one({ b: 1, a: 2 }, 'keys')).toEqual(['a', 'b']);
		expect(one('abc', 'length')).toBe(3);
		expect(one({ a: 1 }, 'has("a")')).toBe(true);
	});

	it('string interpolation and @formats', () => {
		expect(one(null, '"sum=\\(1 + 1)"')).toBe('sum=2');
		expect(one({ a: 1 }, '@json')).toBe('{"a":1}');
		expect(one('hi', '@base64')).toBe('aGk=');
		expect(one('aGk=', '@base64d')).toBe('hi');
	});

	it('path operations: getpath / setpath / del', () => {
		expect(one({ a: { b: 1 } }, 'getpath(["a", "b"])')).toBe(1);
		expect(one({ a: 1 }, 'setpath(["b"]; 2)')).toEqual({ a: 1, b: 2 });
		expect(one({ a: 1, b: 2 }, 'del(.a)')).toEqual({ b: 2 });
		expect(one({ a: 1 }, '.b = 2')).toEqual({ a: 1, b: 2 });
		expect(one({ a: 1 }, '.a |= . + 10')).toEqual({ a: 11 });
	});

	it('if / try and string helpers', () => {
		expect(one(3, 'if . > 2 then "big" else "small" end')).toBe('big');
		expect(vals(null, 'try error("boom") catch .')).toEqual(['boom']);
		expect(one('a,b,c', 'split(",") | length')).toBe(3);
		expect(one(['a', 'b'], 'join("-")')).toBe('a-b');
		expect(one('HELLO', 'ascii_downcase')).toBe('hello');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
//  Errors & safety
// ─────────────────────────────────────────────────────────────────────────────

describe('jq · errors and safety', () => {
	it('reports an arity-qualified "not defined" for unknown functions', () => {
		expect(errOf(null, 'no_such_fn')).toMatch(/no_such_fn\/0 is not defined/);
	});

	it('reports a parse error rather than throwing', () => {
		const r = runJq(null, '.a +');
		expect(r.ok).toBe(false);
	});

	it('never surfaces a raw JS TypeError for wrong builtin arity', () => {
		// Previously `range(3)` etc. leaked "Cannot read properties of undefined".
		for (const expr of ['range(3)', 'any(. > 0)', 'nth(0)', 'first', 'paths']) {
			const r = runJq([1, 2, 3], expr);
			if (!r.ok) expect(r.error).not.toMatch(/Cannot read properties of undefined/);
		}
	});

	it('truncates runaway generators at the output cap', () => {
		const r = runJq(null, 'range(20000)');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.truncated).toBe(true);
			expect(r.values.length).toBe(10000);
		}
	});
});
