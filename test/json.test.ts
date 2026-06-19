import { describe, it, expect } from 'vitest';
import { checkJson, positionFromMessage } from '../src/lib/json';

describe('checkJson', () => {
	it('accepts valid JSON', () => {
		expect(checkJson('{"a":1,"b":[true,null]}')).toEqual({ ok: true });
	});

	it('treats empty / whitespace input as valid (nothing to flag)', () => {
		expect(checkJson('')).toEqual({ ok: true });
		expect(checkJson('   \n\t')).toEqual({ ok: true });
	});

	it('rejects invalid JSON with a message and an in-bounds position', () => {
		const text = '{"a": 1,}';
		const res = checkJson(text);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toBeTruthy();
			expect(res.position).toBeGreaterThanOrEqual(0);
			expect(res.position).toBeLessThanOrEqual(text.length);
		}
	});

	it('rejects common mistakes the Repair feature targets', () => {
		expect(checkJson("{a: 'x'}").ok).toBe(false); // unquoted key + single quotes
		expect(checkJson('[1, 2, 3,]').ok).toBe(false); // trailing comma
	});
});

describe('positionFromMessage', () => {
	it('parses the V8/Chrome "position N" phrasing', () => {
		const text = '{"a": 1,}';
		expect(positionFromMessage('Unexpected token } at position 8', text)).toBe(8);
	});

	it('parses the Firefox/Safari "line L column C" phrasing into an offset', () => {
		// "ab\ncde": line 2 starts at offset 3 ('c'); column 1 → 3, column 3 → 5.
		const text = 'ab\ncde';
		expect(positionFromMessage('expected something at line 2 column 1', text)).toBe(3);
		expect(positionFromMessage('expected something at line 2 column 3', text)).toBe(5);
	});

	it('clamps an out-of-range position to the text length', () => {
		const text = '{}';
		expect(positionFromMessage('error at position 999', text)).toBe(text.length);
	});

	it('falls back to 0 when no position is present in the message', () => {
		expect(positionFromMessage('totally opaque error', 'abc')).toBe(0);
	});
});
