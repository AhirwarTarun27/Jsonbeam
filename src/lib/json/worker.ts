/**
 * Off-main-thread JSON engine — the `onmessage` shell around runEngineOp.
 *
 * `JSON.parse` + `JSON.stringify` on tens of megabytes blocks the main thread
 * for seconds — the tab freezes. Running them here keeps the UI responsive,
 * making good on the homepage's "format files into the tens of megabytes
 * without freezing the tab" claim.
 *
 * Its only dependency is the pure lib/json-engine-core (so the transform stays
 * unit-testable). Spawned lazily by lib/json-engine once an input crosses the
 * size gate — so it costs nothing on small inputs and nothing against any
 * island's initial-JS budget.
 */
import { runEngineOp, type EngineReq, type EngineResult } from './engine-core';

type Req = EngineReq & { id: number };
type Res = EngineResult & { id: number };

// `self` types as a DOM `Window` under the project's lib config, whose
// `postMessage` signature differs from a worker's. Narrow to exactly what we
// use to stay strict-clean without dragging in the conflicting webworker lib.
const ctx = self as unknown as {
	onmessage: ((e: MessageEvent<Req>) => void) | null;
	postMessage(msg: Res): void;
};

ctx.onmessage = (e: MessageEvent<Req>) => {
	const { id, ...req } = e.data;
	ctx.postMessage({ id, ...runEngineOp(req) });
};
