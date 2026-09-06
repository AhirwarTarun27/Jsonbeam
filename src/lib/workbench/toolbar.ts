/**
 * Toolbar action dispatch.
 *
 * Eight islands each wrote their own version of "find every `[data-action]` and
 * wire it up", in three spellings, and two of them queried `document` instead
 * of the island root — so on a page with two islands those handlers would fire
 * for the wrong tool's buttons.
 *
 * This replaces the per-button loop with one delegated listener on the root.
 * That matters beyond tidiness: `querySelectorAll` at mount time only sees
 * buttons that exist at mount time, and several islands add controls later
 * (the diff navigator, the table's filter row). Delegation covers those for
 * free, and costs one listener instead of N.
 */
import { FLASH_MS } from './timing';

export type ActionHandler = (el: HTMLElement, event: MouseEvent) => void;
export type ActionMap = Record<string, ActionHandler>;

export interface BindActionsOptions {
	/**
	 * Called for an action with no handler. Defaults to a no-op in production
	 * builds; tests use it to assert the wiring.
	 */
	onUnknown?: (action: string, el: HTMLElement) => void;
}

/**
 * Wire `[data-action="name"]` clicks within `root` to `handlers[name]`.
 *
 * Returns an unbind function. Islands are never torn down today, but returning
 * it keeps the module honest under test — a listener that cannot be removed
 * leaks across test cases.
 */
export function bindActions(root: HTMLElement, handlers: ActionMap, opts: BindActionsOptions = {}): () => void {
	const onClick = (event: MouseEvent): void => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const el = target.closest<HTMLElement>('[data-action]');
		// `root.contains` guards the case where the click began inside a portal
		// or a detached node that merely bubbles through us.
		if (!el || !root.contains(el)) return;

		const action = el.dataset.action;
		if (!action) return;

		const handler = handlers[action];
		if (!handler) {
			opts.onUnknown?.(action, el);
			return;
		}

		handler(el, event);
	};

	root.addEventListener('click', onClick);
	return () => root.removeEventListener('click', onClick);
}

/**
 * In-flight label flashes, keyed by the control. A WeakMap so a control removed
 * from the DOM mid-flash is still collectable.
 */
const flashing = new WeakMap<HTMLElement, { original: string; timer: number }>();

/**
 * Briefly replace a control's own label, then restore it.
 *
 * Buttons that ARE the feedback — "Copy" → "Copied!" — rather than reporting
 * through the status bar. Three islands wrote this inline, at 1200 / 1200 /
 * 1400 ms, and all three had the same bug:
 *
 *     const orig = btn.textContent;              // "Copy"
 *     btn.textContent = 'Copied!';
 *     setTimeout(() => { btn.textContent = orig; }, 1200);
 *
 * Click twice inside the window and the second call captures "Copied!" as the
 * original, so the button reads "Copied!" from then on. Tracking the flash per
 * element fixes it: a re-entrant call keeps the first original and resets the
 * clock, which is what a user pressing Copy twice actually means.
 */
export function flashLabel(el: HTMLElement, text: string, ms = FLASH_MS): void {
	const active = flashing.get(el);
	const original = active ? active.original : (el.textContent ?? '');
	if (active) clearTimeout(active.timer);

	el.textContent = text;
	const timer = setTimeout(() => {
		flashing.delete(el);
		el.textContent = original;
	}, ms) as unknown as number;

	flashing.set(el, { original, timer });
}
