/**
 * Pure transform at the heart of the JSON worker — no DOM, no `self`, so it
 * runs (and is unit-tested) anywhere. lib/json-worker is just the `onmessage`
 * shell around this; lib/json-engine is the main-thread client that drives it.
 */

export type EngineReq =
	| { op: 'format'; text: string; space: string | number }
	| { op: 'minify'; text: string };

export type EngineResult = { ok: true; result: string } | { ok: false; error: string };

/** Parse + (re)serialize `text`. Returns a tagged result rather than throwing, so the worker shell can post either branch back. */
export function runEngineOp(req: EngineReq): EngineResult {
	try {
		const result =
			req.op === 'minify'
				? JSON.stringify(JSON.parse(req.text))
				: JSON.stringify(JSON.parse(req.text), null, req.space);
		return { ok: true, result };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
