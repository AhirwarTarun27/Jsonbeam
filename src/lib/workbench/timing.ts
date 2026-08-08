/**
 * The workbench's two timing constants, and the debounce built on them.
 *
 * These were literals scattered across the islands and they had drifted: input
 * debounce was written as 250 ms, 300 ms and 320 ms, and the status flash as
 * 1200 ms, 1300 ms and 1400 ms. Nobody chose those differences — they are
 * copy-paste noise, but the user feels them as tools that respond at subtly
 * different speeds.
 *
 * Changing a number here changes it everywhere, which is the point.
 */

/**
 * How long to wait after the last keystroke before re-parsing.
 *
 * 300 ms is below the ~400 ms at which a pause starts to read as lag, and
 * above a fast typist's inter-key gap (~120 ms), so a burst of typing costs one
 * parse rather than one per character. Parsing is the expensive step on large
 * documents, so this is the single most load-bearing number in the workbench.
 */
export const DEBOUNCE_MS = 300;

/**
 * How long a transient message ("Copied", "Exported 1,240 rows") holds before
 * the status bar reverts to describing the document.
 *
 * Long enough to read a short phrase without re-reading; short enough that the
 * real state is never stale for long.
 */
export const FLASH_MS = 1400;

export interface Debounced<A extends unknown[]> {
	(...args: A): void;
	/** Run the pending call now, if any. */
	flush(): void;
	/** Drop the pending call. Call this when tearing an island down. */
	cancel(): void;
}

/**
 * Trailing-edge debounce: `fn` runs `ms` after the last call, with that last
 * call's arguments.
 *
 * Trailing rather than leading because every caller here is "recompute from the
 * current input" — the newest arguments are the only ones that matter, and
 * acting on the first keystroke of a burst would show output for a document the
 * user has already moved past.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number = DEBOUNCE_MS): Debounced<A> {
	let timer = 0;
	let pending: A | null = null;

	const run = (): void => {
		timer = 0;
		const args = pending;
		pending = null;
		if (args) fn(...args);
	};

	const debounced = (...args: A): void => {
		pending = args;
		clearTimeout(timer);
		timer = setTimeout(run, ms) as unknown as number;
	};

	debounced.flush = (): void => {
		if (!timer) return;
		clearTimeout(timer);
		run();
	};

	debounced.cancel = (): void => {
		clearTimeout(timer);
		timer = 0;
		pending = null;
	};

	return debounced;
}
