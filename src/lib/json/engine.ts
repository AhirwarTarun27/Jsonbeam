/**
 * Main-thread client for the JSON worker (lib/json-worker).
 *
 * Spawns a single worker lazily, tracks in-flight requests by id, and hands
 * back one Promise per call. Import this with a dynamic `import()` (as the
 * formatter does) so neither this module nor the worker chunk counts against
 * the island's initial-JS budget — they load only when an input is large
 * enough to be worth moving off the main thread.
 */

interface WorkerRes {
	id: number;
	ok: boolean;
	result?: string;
	error?: string;
}

type Pending = { resolve: (s: string) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
	if (worker) return worker;
	const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	w.onmessage = (e: MessageEvent<WorkerRes>) => {
		const { id, ok, result, error } = e.data;
		const p = pending.get(id);
		if (!p) return;
		pending.delete(id);
		if (ok && result !== undefined) p.resolve(result);
		else p.reject(new Error(error ?? 'Worker error'));
	};
	w.onerror = () => {
		// Catastrophic worker failure — fail everything in flight rather than hang.
		for (const p of pending.values()) p.reject(new Error('Worker crashed'));
		pending.clear();
		worker = null;
	};
	worker = w;
	return w;
}

function call(req: Record<string, unknown>): Promise<string> {
	const w = ensureWorker();
	const id = nextId++;
	return new Promise<string>((resolve, reject) => {
		pending.set(id, { resolve, reject });
		w.postMessage({ ...req, id });
	});
}

/** Pretty-print `text` (parse + stringify) off the main thread. Rejects on invalid JSON. */
export function formatJson(text: string, space: string | number): Promise<string> {
	return call({ op: 'format', text, space });
}

/** Minify `text` (parse + compact stringify) off the main thread. Rejects on invalid JSON. */
export function minifyJson(text: string): Promise<string> {
	return call({ op: 'minify', text });
}
