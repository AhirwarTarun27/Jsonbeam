/**
 * Pure JSON validation helpers — shared by the editor island and unit-tested
 * directly. Framework-free so future tools (Phase 2 query/diff/convert) reuse it.
 */

export type JsonCheck =
	| { ok: true }
	| { ok: false; message: string; position: number };

/**
 * Parse-check a string. Empty input counts as valid (nothing to flag). On
 * failure, returns the engine's message plus a 0-based character offset for the
 * error, so callers can anchor a squiggle exactly where parsing broke.
 */
export function checkJson(text: string): JsonCheck {
	if (text.trim() === '') return { ok: true };
	try {
		JSON.parse(text);
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Invalid JSON';
		return { ok: false, message, position: positionFromMessage(message, text) };
	}
}

/**
 * Extract a 0-based offset from a `JSON.parse` error message. Handles both the
 * V8/Chrome phrasing ("… at position 42") and the Firefox/Safari phrasing
 * ("… at line 3 column 5"); falls back to 0 when neither is present. The result
 * is always clamped to the text length.
 */
export function positionFromMessage(message: string, text: string): number {
	const byPos = message.match(/position (\d+)/i);
	if (byPos) return clamp(Number(byPos[1]), 0, text.length);

	const byLineCol = message.match(/line (\d+) column (\d+)/i);
	if (byLineCol) {
		const line = Math.max(1, Number(byLineCol[1]));
		const column = Math.max(1, Number(byLineCol[2]));
		return clamp(offsetOf(text, line, column), 0, text.length);
	}
	return 0;
}

/** Convert a 1-based (line, column) pair into a 0-based character offset. */
function offsetOf(text: string, line: number, column: number): number {
	const lines = text.split('\n');
	let offset = 0;
	for (let i = 0; i < line - 1 && i < lines.length; i++) {
		offset += lines[i].length + 1; // +1 for the consumed newline
	}
	return offset + (column - 1);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}
