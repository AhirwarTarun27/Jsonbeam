/**
 * The status bar every island carries: a coloured dot, a state label, and an
 * optional stats readout.
 *
 * There were eight copies of this in two incompatible dialects — six painted
 * the dot with `style.backgroundColor = 'var(--color-success)'`, two rebuilt
 * `className` from scratch to swap a Tailwind `bg-*` class. The class dialect
 * also silently dropped any other class on the dot, and neither of those two
 * islands coloured the label on error, so the same failure looked different
 * depending on which tool you were in.
 *
 * The inline-token dialect wins here: it sets one property, leaves the
 * element's classes alone, and still resolves through the design tokens rather
 * than a literal.
 *
 * DOM contract (already true of all eight islands):
 *   <span role="status" aria-live="polite">
 *     <span data-dot></span><span data-label>Ready</span>
 *   </span>
 *   <span data-stats></span>            <!-- optional -->
 *
 * The dot and label are looked up *inside* `[role="status"]` rather than
 * anywhere in the island, because the graph viewer also has a `data-dot` in its
 * minimap SVG. Scoping to the live region makes that collision impossible.
 */
import { FLASH_MS } from './timing';

export type StatusState = 'idle' | 'ok' | 'error' | 'busy';

/** Dot colour per state. `busy` is warning — amber reads as "working", not "wrong". */
const DOT: Record<StatusState, string> = {
	idle: 'var(--color-mute)',
	ok: 'var(--color-success)',
	error: 'var(--color-error)',
	busy: 'var(--color-warning)',
};

/**
 * Label colour. Only errors deviate: the deep variant is the one that clears
 * contrast against the light toolbar (the plain error red does not).
 */
const LABEL: Record<StatusState, string> = {
	idle: 'var(--color-ink)',
	ok: 'var(--color-ink)',
	error: 'var(--color-error-deep)',
	busy: 'var(--color-ink)',
};

export interface StatusBar {
	/**
	 * The label element, or null if the island has no status bar.
	 *
	 * Exposed for effects that are about the element rather than its content —
	 * the formatter shakes it when you try to format invalid JSON, where the
	 * text does not change and so `set` has nothing to say.
	 */
	readonly label: HTMLElement | null;
	/** Set the durable state — what the document actually is right now. */
	set(state: StatusState, text: string): void;
	/**
	 * Show a transient message, then revert to the durable state.
	 * No-op fallback to `set` when the island passed no `refresh`.
	 */
	flash(state: StatusState, text: string): void;
	/** Set the secondary readout (`data-stats`), e.g. "1,240 rows · 38 KB". */
	stats(text: string): void;
	/** Cancel a pending flash revert. Call when tearing the island down. */
	destroy(): void;
}

export interface StatusBarOptions {
	/**
	 * Recompute and re-`set` the durable state. Called when a flash expires.
	 * Islands pass their existing `refreshStatus`.
	 */
	refresh?: () => void;
	/** Flash duration. Defaults to the shared `FLASH_MS`. */
	flashMs?: number;
}

/**
 * Bind a status bar to an island root.
 *
 * Every element is optional: an island without a `data-stats` span simply has a
 * `stats()` that does nothing, so callers never need to null-check. That is
 * deliberate — the null-guard dance was itself part of the duplication.
 */
export function createStatusBar(root: ParentNode, opts: StatusBarOptions = {}): StatusBar {
	const region = root.querySelector<HTMLElement>('[role="status"]');
	const dot = region?.querySelector<HTMLElement>('[data-dot]') ?? null;
	const label = region?.querySelector<HTMLElement>('[data-label]') ?? null;
	const statsEl = root.querySelector<HTMLElement>('[data-stats]');
	const flashMs = opts.flashMs ?? FLASH_MS;

	let flashTimer = 0;

	const set = (state: StatusState, text: string): void => {
		if (dot) dot.style.backgroundColor = DOT[state];
		if (label) {
			label.textContent = text;
			label.style.color = LABEL[state];
		}
	};

	return {
		label,

		set(state, text) {
			// A durable update supersedes any in-flight flash; leaving the timer
			// armed would let a stale message overwrite the newer truth.
			clearTimeout(flashTimer);
			flashTimer = 0;
			set(state, text);
		},

		flash(state, text) {
			set(state, text);
			clearTimeout(flashTimer);
			const { refresh } = opts;
			if (!refresh) return;
			flashTimer = setTimeout(() => {
				flashTimer = 0;
				refresh();
			}, flashMs) as unknown as number;
		},

		stats(text) {
			if (statsEl) statsEl.textContent = text;
		},

		destroy() {
			clearTimeout(flashTimer);
			flashTimer = 0;
		},
	};
}
