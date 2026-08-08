import { describe, it, expect } from 'vitest';
import { runJq } from '../src/lib/json/jq';

// A broad behavioral fixture suite for the hand-rolled jq interpreter (F2).
// Each expectation is the canonical jq output for the filter, hand-verified
// against the jq manual — a real-jq diff we can run in CI without a jq binary.
// Companion to jq.test.ts (which guards the C1/C2 regressions specifically).

function vals(input: unknown, expr: string): unknown[] {
	const r = runJq(input, expr);
	if (!r.ok) throw new Error(`jq error for \`${expr}\`: ${r.error}`);
	return r.values;
}
function one(input: unknown, expr: string): unknown {
	const v = vals(input, expr);
	if (v.length !== 1) throw new Error(`expected 1 value from \`${expr}\`, got ${v.length}: ${JSON.stringify(v)}`);
	return v[0];
}

describe('jq · total order, sort, unique', () => {
	it('sorts across jq type order: null < bool < number < string < array < object', () => {
		expect(one([true, 42, 'x', null, [1], { a: 1 }, false], 'sort')).toEqual([
			null, false, true, 42, 'x', [1], { a: 1 },
		]);
	});
	it('sorts lowercase strings lexically', () => {
		expect(one(['banana', 'apple', 'cherry'], 'sort')).toEqual(['apple', 'banana', 'cherry']);
	});
	it('sorts arrays element-wise then by length', () => {
		expect(one([[2], [1, 1], [1]], 'sort')).toEqual([[1], [1, 1], [2]]);
	});
	it('unique dedupes after sorting', () => {
		expect(one([3, 1, 2, 1, 3], 'unique')).toEqual([1, 2, 3]);
	});
	it('reverse on arrays and strings', () => {
		expect(one([1, 2, 3], 'reverse')).toEqual([3, 2, 1]);
		expect(one('abc', 'explode | reverse | implode')).toBe('cba');
	});
});

describe('jq · arithmetic and operators', () => {
	it('numeric arithmetic with precedence', () => {
		expect(one(null, '2 + 3 * 4')).toBe(14);
		expect(one(null, '7 / 2')).toBe(3.5);
		expect(one(null, '7 % 3')).toBe(1);
		expect(one(null, '2 * (3 + 4)')).toBe(14);
	});
	it('object addition merges (right wins)', () => {
		expect(one(null, '{a:1,b:2} + {b:3,c:4}')).toEqual({ a: 1, b: 3, c: 4 });
	});
	it('array addition concatenates; subtraction removes', () => {
		expect(one(null, '[1,2] + [3,4]')).toEqual([1, 2, 3, 4]);
		expect(one(null, '[1,2,3,2] - [2]')).toEqual([1, 3]);
	});
	it('string concatenation', () => {
		expect(one(null, '"foo" + "bar"')).toBe('foobar');
	});
	it('null is the identity for +', () => {
		expect(one(null, 'null + 1')).toBe(1);
		expect(one(null, '{a:1} + null')).toEqual({ a: 1 });
	});
	it('// keeps the first non-null, non-false value', () => {
		expect(one(null, 'false // 5')).toBe(5);
		expect(one(null, 'null // 5')).toBe(5);
		expect(one(null, '0 // 5')).toBe(0);
		expect(one(null, '(empty) // 5')).toBe(5);
	});
});

describe('jq · length, type, not', () => {
	it('length across types', () => {
		expect(one('abc', 'length')).toBe(3);
		expect(one([1, 2, 3, 4], 'length')).toBe(4);
		expect(one({ a: 1, b: 2 }, 'length')).toBe(2);
		expect(one(null, 'length')).toBe(0);
		expect(one(-5, 'length')).toBe(5);
	});
	it('type names', () => {
		expect(one([null, true, 1, 'x', [], {}], 'map(type)')).toEqual([
			'null', 'boolean', 'number', 'string', 'array', 'object',
		]);
	});
	it('not negates truthiness (only null/false are falsy)', () => {
		expect(one(true, 'not')).toBe(false);
		expect(one(null, 'not')).toBe(true);
		expect(one(0, 'not')).toBe(false);
	});
});

describe('jq · string builtins', () => {
	it('case conversion', () => {
		expect(one('Hello', 'ascii_downcase')).toBe('hello');
		expect(one('Hello', 'ascii_upcase')).toBe('HELLO');
	});
	it('trim prefixes/suffixes', () => {
		expect(one('hello', 'ltrimstr("he")')).toBe('llo');
		expect(one('hello', 'rtrimstr("lo")')).toBe('hel');
		expect(one('hello', 'ltrimstr("xy")')).toBe('hello');
	});
	it('startswith / endswith', () => {
		expect(one('hello', 'startswith("he")')).toBe(true);
		expect(one('hello', 'endswith("lo")')).toBe(true);
		expect(one('hello', 'startswith("lo")')).toBe(false);
	});
	it('split (literal) and join', () => {
		expect(one('a,b,c', 'split(",")')).toEqual(['a', 'b', 'c']);
		expect(one(['a', 'b', 'c'], 'join("-")')).toBe('a-b-c');
	});
	it('explode / implode', () => {
		expect(one('Hi', 'explode')).toEqual([72, 105]);
		expect(one([72, 105], 'implode')).toBe('Hi');
	});
	it('string slicing', () => {
		expect(one('abcdef', '.[2:4]')).toBe('cd');
		expect(one('abcdef', '.[3:]')).toBe('def');
	});
	it('interpolation', () => {
		expect(one(null, '"sum=\\(1 + 1)"')).toBe('sum=2');
		expect(one({ n: 'Ada' }, '"hi \\(.n)!"')).toBe('hi Ada!');
	});
});

describe('jq · @formats', () => {
	it('@json / @text', () => {
		expect(one({ a: 1 }, '@json')).toBe('{"a":1}');
		expect(one(42, '@text')).toBe('42');
	});
	it('@csv quotes strings, leaves numbers bare', () => {
		expect(one(['x', 'y,z', 5], '@csv')).toBe('"x","y,z",5');
	});
	it('@tsv tab-joins', () => {
		expect(one(['a', 'b', 'c'], '@tsv')).toBe('a\tb\tc');
	});
	it('@html escapes', () => {
		expect(one('<b>&"', '@html')).toBe('&lt;b&gt;&amp;&quot;');
	});
	it('@uri / @base64 / @base64d', () => {
		expect(one('a b&c', '@uri')).toBe('a%20b%26c');
		expect(one('hi', '@base64')).toBe('aGk=');
		expect(one('aGk=', '@base64d')).toBe('hi');
	});
});

describe('jq · array builtins', () => {
	it('flatten (deep) and flatten(depth)', () => {
		expect(one([1, [2, [3, [4]]]], 'flatten')).toEqual([1, 2, 3, 4]);
		expect(one([1, [2, [3, [4]]]], 'flatten(1)')).toEqual([1, 2, [3, [4]]]);
	});
	it('min / max / min_by / max_by', () => {
		expect(one([3, 1, 2], 'min')).toBe(1);
		expect(one([3, 1, 2], 'max')).toBe(3);
		expect(one([{ n: 3 }, { n: 1 }, { n: 2 }], 'min_by(.n)')).toEqual({ n: 1 });
		expect(one([{ n: 3 }, { n: 1 }, { n: 2 }], 'max_by(.n)')).toEqual({ n: 3 });
		expect(one([], 'min')).toBe(null);
	});
	it('group_by sorts groups by key, preserves order within', () => {
		expect(one(['a', 'bb', 'c', 'dd'], 'group_by(length)')).toEqual([['a', 'c'], ['bb', 'dd']]);
	});
	it('unique_by', () => {
		expect(one([{ k: 1, v: 'a' }, { k: 1, v: 'b' }, { k: 2, v: 'c' }], 'unique_by(.k) | length')).toBe(2);
	});
	it('add over numbers, strings, arrays, objects, empty', () => {
		expect(one([1, 2, 3], 'add')).toBe(6);
		expect(one(['a', 'b'], 'add')).toBe('ab');
		expect(one([[1], [2, 3]], 'add')).toEqual([1, 2, 3]);
		expect(one([{ a: 1 }, { b: 2 }], 'add')).toEqual({ a: 1, b: 2 });
		expect(one([], 'add')).toBe(null);
	});
	it('index / rindex / indices', () => {
		expect(one([1, 2, 3, 2, 1], 'index(2)')).toBe(1);
		expect(one([1, 2, 3, 2, 1], 'rindex(2)')).toBe(3);
		expect(one([1, 2, 3, 2, 1], 'indices(2)')).toEqual([1, 3]);
	});
	it('contains (substring and structural)', () => {
		expect(one('foobar', 'contains("bar")')).toBe(true);
		expect(one({ a: { b: 1, c: 2 } }, 'contains({a:{b:1}})')).toBe(true);
		expect(one([1, 2, 3], 'contains([3, 1])')).toBe(true);
	});
	it('range arities', () => {
		expect(one(null, '[range(4)]')).toEqual([0, 1, 2, 3]);
		expect(one(null, '[range(2; 5)]')).toEqual([2, 3, 4]);
		expect(one(null, '[range(0; 10; 3)]')).toEqual([0, 3, 6, 9]);
	});
});

describe('jq · object builtins', () => {
	it('to_entries / from_entries roundtrip', () => {
		expect(one({ a: 1, b: 2 }, 'to_entries')).toEqual([
			{ key: 'a', value: 1 },
			{ key: 'b', value: 2 },
		]);
		expect(one([{ key: 'a', value: 1 }, { key: 'b', value: 2 }], 'from_entries')).toEqual({ a: 1, b: 2 });
	});
	it('with_entries transforms key/value pairs', () => {
		expect(one({ a: 1, b: 2 }, 'with_entries(.value += 10)')).toEqual({ a: 11, b: 12 });
	});
	it('keys are sorted; keys_unsorted preserve insertion', () => {
		expect(one({ b: 1, a: 2 }, 'keys')).toEqual(['a', 'b']);
		expect(one({ b: 1, a: 2 }, 'keys_unsorted')).toEqual(['b', 'a']);
	});
	it('has / in', () => {
		expect(one({ a: 1 }, 'has("a")')).toBe(true);
		expect(one([1, 2, 3], 'has(2)')).toBe(true);
		expect(one('a', 'in({"a":1,"b":2})')).toBe(true);
	});
	it('getpath / setpath / delpaths', () => {
		expect(one({ a: { b: 1 } }, 'getpath(["a","b"])')).toBe(1);
		expect(one({ a: { b: 1 } }, 'setpath(["a","b"]; 9)')).toEqual({ a: { b: 9 } });
		expect(one({ a: 1, b: 2 }, 'delpaths([["a"]])')).toEqual({ b: 2 });
	});
	it('del with multiple paths', () => {
		expect(one({ a: 1, b: 2, c: 3 }, 'del(.a, .c)')).toEqual({ b: 2 });
	});
});

describe('jq · updates and path expressions', () => {
	it('arithmetic-update and pipe-update', () => {
		expect(one({ a: 1 }, '.a += 5')).toEqual({ a: 6 });
		expect(one({ a: 1 }, '.a |= . + 1')).toEqual({ a: 2 });
	});
	it('alternative-update fills missing/null', () => {
		expect(one({ a: null }, '.a //= 5')).toEqual({ a: 5 });
	});
	it('nested and multi-target updates', () => {
		expect(one({ a: [1, 2] }, '.a[1] = 9')).toEqual({ a: [1, 9] });
		expect(one({ a: 1, b: 2 }, '(.a, .b) |= . + 1')).toEqual({ a: 2, b: 3 });
	});
	it('path() yields the path array', () => {
		expect(one({ a: { b: 1 } }, 'path(.a.b)')).toEqual(['a', 'b']);
	});
});

describe('jq · control flow', () => {
	it('if / elif / else', () => {
		expect(one(2, 'if . == 1 then "one" elif . == 2 then "two" else "many" end')).toBe('two');
	});
	it('if without else passes the input through on false', () => {
		expect(one(5, 'if . > 3 then "big" end')).toBe('big');
		expect(one(2, 'if . > 3 then "big" end')).toBe(2);
	});
	it('reduce folds a stream', () => {
		expect(one(null, 'reduce range(5) as $x (0; . + $x)')).toBe(10);
	});
	it('foreach emits each step', () => {
		expect(one(null, '[foreach range(1;4) as $x (0; . + $x)]')).toEqual([1, 3, 6]);
	});
	it('while / until / repeat+limit', () => {
		expect(one(1, '[while(. < 50; . * 2)]')).toEqual([1, 2, 4, 8, 16, 32]);
		expect(one(1, 'until(. > 50; . * 2)')).toBe(64);
		expect(one(7, '[limit(3; repeat(.))]')).toEqual([7, 7, 7]);
	});
	it('try/catch and the ? error-suppression operator', () => {
		expect(one(null, 'try error("boom") catch .')).toBe('boom');
		expect(one([{ a: 1 }, 2, { a: 3 }], '[.[] | .a?]')).toEqual([1, 3]);
	});
});

describe('jq · recursion', () => {
	it('.. recurses over the whole document', () => {
		expect(one({ a: { b: 1 } }, '[..]')).toEqual([{ a: { b: 1 } }, { b: 1 }, 1]);
	});
	it('recurse with a generator', () => {
		expect(one(1, '[recurse(if . < 4 then . + 1 else empty end)]')).toEqual([1, 2, 3, 4]);
	});
	it('walk transforms bottom-up', () => {
		expect(one({ a: 1, b: { c: 2 } }, 'walk(if type == "number" then . + 1 else . end)')).toEqual({
			a: 2,
			b: { c: 3 },
		});
	});
});

describe('jq · regex (capture / scan / test / match)', () => {
	it('capture returns named groups as an object', () => {
		expect(one('2024-01-15', 'capture("(?<y>[0-9]+)-(?<m>[0-9]+)-(?<d>[0-9]+)")')).toEqual({
			y: '2024',
			m: '01',
			d: '15',
		});
	});
	it('scan yields matches, or capture-arrays when groups are present', () => {
		expect(one('a1b2c3', '[scan("[0-9]")]')).toEqual(['1', '2', '3']);
		expect(one('a1b2', '[scan("([a-z])([0-9])")]')).toEqual([['a', '1'], ['b', '2']]);
	});
	it('test with flags; match reports offset/length/string', () => {
		expect(one('ABC', 'test("abc"; "i")')).toBe(true);
		expect(one('abcdef', 'match("cd") | {offset, length, string}')).toEqual({
			offset: 2,
			length: 2,
			string: 'cd',
		});
	});
	it('sub / gsub do literal replacement', () => {
		expect(one('hello', 'sub("l"; "L")')).toBe('heLlo');
		expect(one('hello', 'gsub("l"; "L")')).toBe('heLLo');
	});
});

describe('jq · numbers and conversions', () => {
	it('floor / ceil / round / sqrt / pow / fabs', () => {
		expect(one(3.7, 'floor')).toBe(3);
		expect(one(3.2, 'ceil')).toBe(4);
		expect(one(3.5, 'round')).toBe(4);
		expect(one(9, 'sqrt')).toBe(3);
		expect(one(null, 'pow(2; 10)')).toBe(1024);
		expect(one(-4, 'fabs')).toBe(4);
	});
	it('tostring / tonumber / tojson / fromjson', () => {
		expect(one(42, 'tostring')).toBe('42');
		expect(one('42', 'tonumber')).toBe(42);
		expect(one({ a: 1 }, 'tojson')).toBe('{"a":1}');
		expect(one('[1,2,3]', 'fromjson')).toEqual([1, 2, 3]);
	});
});

describe('jq · truthiness (only null and false are falsy)', () => {
	it('if treats 0 / "" / [] as truthy', () => {
		expect(one(0, 'if . then "t" else "f" end')).toBe('t');
		expect(one('', 'if . then "t" else "f" end')).toBe('t');
		expect(one(null, 'if . then "t" else "f" end')).toBe('f');
		expect(one(false, 'if . then "t" else "f" end')).toBe('f');
	});
	it('and / or use jq truthiness', () => {
		expect(one(null, '0 and 1')).toBe(true);
		expect(one(null, 'false or 0')).toBe(true);
		expect(one(null, 'null and 1')).toBe(false);
	});
	it('select keeps 0 (truthy), drops null/false', () => {
		expect(one([0, null, 1, false, 2], '[.[] | select(.)]')).toEqual([0, 1, 2]);
	});
	it('multi-path assignment sets every targeted path', () => {
		expect(one({ a: 1, b: 2, c: 3 }, '(.a, .b) = 0')).toEqual({ a: 0, b: 0, c: 3 });
	});
});
