/**
 * Shared "expand to full screen" workbench mode for the tool islands.
 *
 * Promotes an island's root to a full-viewport overlay (CSS `.jb-expanded` →
 * `position: fixed; inset: 0`) so the editor fills the whole screen — maximum
 * room for large documents, zero surrounding chrome. Crucially it toggles a
 * *class on the existing root*: the same CodeMirror / viewer instance stays
 * mounted, so undo history, selection, scroll, and cursor all survive entering
 * and leaving full screen. No re-mount, no second instance, ~0 KB of new JS.
 *
 * Continuity (the "one workbench" promise, alongside lib/doc-store): the
 * expanded state is persisted in `sessionStorage`, so switching tools via ⌘K
 * lands you already-expanded on the next tool — the document carries (doc-store)
 * and so does the full-screen mode. A *fresh* visit always starts collapsed
 * (never auto-expand a first arrival — that would surprise the user and hide the
 * page's ad slots before they're ever seen).
 *
 * Esc handling coexists with the ⌘K command palette (a native <dialog> in the
 * top layer): the listener runs in capture phase and bows out whenever a
 * `dialog[open]` exists, so the palette owns Esc while open and the workbench
 * owns it otherwise.
 *
 * Privacy law (CLAUDE.md): the only thing persisted is the boolean expand flag
 * in `sessionStorage` — never user data. The one analytics ping (`expand_editor`)
 * carries the tool name only, fired exclusively on an explicit user expand.
 */

const KEY = 'jb-workbench-expanded';

// Toggle shortcut. Captured before the editor can swallow it (like ⌘K), so a
// modifier combo is safe even while typing. Shown on the button as a kbd hint.
const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const SHORTCUT_LABEL = IS_APPLE ? '⌘⇧F' : 'Ctrl ⇧F';

const ICON_EXPAND =
	'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>';
const ICON_COLLAPSE =
	'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4"/></svg>';

export interface FullscreenOptions {
	/** The island root promoted to the full-viewport overlay (e.g. #jb-formatter). */
	root: HTMLElement;
	/** Tool name shown in the expanded slim bar, e.g. "Formatter", "Tree". */
	toolName: string;
	/** The toggle button. Defaults to `[data-jb-expand]` within `root`. */
	button?: HTMLButtonElement | null;
	/** The toolbar the brand strip is injected into. Defaults to `[data-jb-toolbar]`. */
	toolbar?: HTMLElement | null;
	/**
	 * Runs after each state change with the new expanded flag. Use for
	 * island-specific work: editor islands refocus + re-measure their CodeMirror
	 * view so it fills the new geometry.
	 */
	onChange?: (expanded: boolean) => void;
}

export interface FullscreenControl {
	readonly expanded: boolean;
	expand(): void;
	collapse(): void;
	toggle(): void;
}

function readFlag(): boolean {
	try {
		return sessionStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

function writeFlag(on: boolean): void {
	try {
		if (on) sessionStorage.setItem(KEY, '1');
		else sessionStorage.removeItem(KEY);
	} catch {
		/* storage blocked — mode still works for this view, just won't carry */
	}
}

/** Page-level engagement ping (never user data). gtag may be absent (blocked). */
function track(toolName: string): void {
	const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
	try {
		gtag?.('event', 'expand_editor', { tool: toolName });
	} catch {
		/* analytics is best-effort */
	}
}

/**
 * Wire an island's full-screen toggle. Returns a handle exposing the live
 * `expanded` flag plus programmatic `expand` / `collapse` / `toggle`.
 */
export function initFullscreen(opts: FullscreenOptions): FullscreenControl {
	const { root, toolName, onChange } = opts;
	const button = opts.button ?? root.querySelector<HTMLButtonElement>('[data-jb-expand]');
	const toolbar = opts.toolbar ?? root.querySelector<HTMLElement>('[data-jb-toolbar]');

	let expanded = false;
	let backdrop: HTMLElement | null = null;
	let lastFocused: HTMLElement | null = null;

	// Brand strip — injected once, shown by CSS only while expanded. Keeps the
	// "you're still in JSON Beam" anchor in the otherwise chrome-free overlay
	// without duplicating markup across the eight islands.
	if (toolbar && !toolbar.querySelector('.jb-workbench-brand')) {
		const brand = document.createElement('div');
		brand.className = 'jb-workbench-brand';
		const mark = document.createElement('span');
		mark.className = 'jb-workbench-logo';
		mark.textContent = '{}';
		mark.setAttribute('aria-hidden', 'true');
		const title = document.createElement('span');
		title.className = 'jb-workbench-title';
		title.textContent = `JSON Beam · ${toolName}`;
		// Keep tool-switching discoverable in full screen (the tool rail, which
		// normally carries Search/⌘K, is hidden here). Clicking dispatches the
		// same global ⌘K the command palette already listens for — no coupling to
		// the palette module, and it lazy-loads the dialog exactly as the rail does.
		const search = document.createElement('button');
		search.type = 'button';
		search.className = 'jb-cmdk-trigger jb-workbench-search';
		search.setAttribute('aria-label', 'Search tools');
		search.title = 'Search tools';
		search.innerHTML =
			'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"></circle><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>' +
			'<span>Search</span>' +
			`<kbd aria-hidden="true">${IS_APPLE ? '⌘K' : 'Ctrl K'}</kbd>`;
		search.addEventListener('click', () => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
		});
		brand.append(mark, title, search);
		toolbar.prepend(brand);
	}

	// A visible kbd hint on the button teaches the shortcut (Ctrl/⌘+Shift+F to
	// open, Esc to exit) without a tooltip hunt — injected once, hidden on touch.
	if (button && !button.querySelector('.jb-expand-kbd')) {
		const kbd = document.createElement('kbd');
		kbd.className = 'jb-expand-kbd';
		kbd.setAttribute('aria-hidden', 'true');
		button.appendChild(kbd);
	}

	function paintButton(): void {
		if (!button) return;
		button.setAttribute('aria-pressed', String(expanded));
		button.title = expanded ? 'Exit full screen (Esc)' : `Expand to full screen (${SHORTCUT_LABEL})`;
		const ico = button.querySelector<HTMLElement>('.jb-expand-ico');
		if (ico) ico.innerHTML = expanded ? ICON_COLLAPSE : ICON_EXPAND;
		const lbl = button.querySelector<HTMLElement>('.jb-expand-label');
		if (lbl) lbl.textContent = expanded ? 'Exit' : 'Full screen';
		const kbd = button.querySelector<HTMLElement>('.jb-expand-kbd');
		if (kbd) kbd.textContent = expanded ? 'Esc' : SHORTCUT_LABEL;
	}

	function lockScroll(on: boolean): void {
		document.documentElement.classList.toggle('jb-scroll-lock', on);
	}

	function makeBackdrop(animate: boolean): void {
		if (backdrop) return;
		backdrop = document.createElement('div');
		backdrop.className = 'jb-workbench-backdrop';
		if (animate) backdrop.classList.add('jb-opening');
		document.body.appendChild(backdrop);
	}

	function removeBackdrop(animate: boolean): void {
		const el = backdrop;
		backdrop = null;
		if (!el) return;
		if (!animate) {
			el.remove();
			return;
		}
		el.classList.remove('jb-opening');
		el.classList.add('jb-closing');
		const done = (): void => el.remove();
		el.addEventListener('animationend', done, { once: true });
		window.setTimeout(done, 400); // fallback if animationend never fires
	}

	/** `animate` is false only on a session-restore (already-expanded arrival). */
	function expand(animate: boolean, fromUser: boolean): void {
		if (expanded) return;
		expanded = true;
		lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

		makeBackdrop(animate);
		lockScroll(true);
		root.classList.add('jb-expanded');
		if (animate) {
			root.classList.add('jb-opening');
			root.addEventListener('animationend', () => root.classList.remove('jb-opening'), { once: true });
		}
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-modal', 'true');
		root.setAttribute('aria-label', `${toolName} — full-screen workbench. Press Escape to exit.`);
		root.tabIndex = -1;

		paintButton();
		writeFlag(true);
		if (fromUser) track(toolName);

		// Hand focus to the island (editor islands focus their CodeMirror view);
		// fall back to the overlay itself so keyboard users land inside.
		onChange?.(true);
		if (document.activeElement === document.body || !root.contains(document.activeElement)) {
			root.focus();
		}
	}

	function collapse(): void {
		if (!expanded) return;
		expanded = false;

		removeBackdrop(true);
		root.classList.add('jb-collapsing');
		let cleaned = false;
		const cleanup = (): void => {
			if (cleaned) return;
			cleaned = true;
			root.classList.remove('jb-expanded', 'jb-collapsing');
		};
		root.addEventListener('animationend', cleanup, { once: true });
		window.setTimeout(cleanup, 400); // fallback

		lockScroll(false);
		root.removeAttribute('role');
		root.removeAttribute('aria-modal');
		root.removeAttribute('aria-label');
		root.removeAttribute('tabindex');

		paintButton();
		writeFlag(false);
		onChange?.(false);

		// Return focus to the trigger (or wherever it was before expanding).
		(button ?? lastFocused)?.focus();
	}

	function toggle(): void {
		if (expanded) collapse();
		else expand(true, true);
	}

	button?.addEventListener('click', () => toggle());

	// Keyboard: Ctrl/⌘+Shift+F toggles, Esc exits. On `window` in capture phase
	// (the same surface the ⌘K palette uses) so the editor never swallows them,
	// and both bow out while a modal <dialog> (the ⌘K palette) is open, so the
	// palette keeps ownership of its keys.
	window.addEventListener(
		'keydown',
		(e) => {
			if (document.querySelector('dialog[open]')) return;
			const isToggle =
				(e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
			if (isToggle) {
				e.preventDefault();
				e.stopPropagation();
				toggle();
				return;
			}
			if (e.key === 'Escape' && expanded) {
				e.preventDefault();
				e.stopPropagation();
				collapse();
			}
		},
		{ capture: true },
	);

	// Lightweight focus containment for the overlay's toolbar controls. The
	// editor manages its own Tab (indent), so we bow out whenever focus is inside
	// it — this only wraps focus at the toolbar boundary, never fights CodeMirror.
	root.addEventListener('keydown', (e) => {
		if (e.key !== 'Tab' || !expanded) return;
		if (root.querySelector('.cm-editor')?.contains(document.activeElement)) return;
		const focusables = Array.from(
			root.querySelectorAll<HTMLElement>(
				'button:not([disabled]), select, a[href], [tabindex]:not([tabindex="-1"]), .cm-content',
			),
		).filter((el) => el.offsetParent !== null || el.classList.contains('cm-content'));
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	});

	paintButton();

	// Session-restore: an explicit expand earlier this session carries across the
	// tool switch. Applied without the entrance animation so the new page simply
	// arrives full-screen rather than re-playing the lift.
	if (readFlag()) expand(false, false);

	return {
		get expanded() {
			return expanded;
		},
		expand: () => expand(true, true),
		collapse,
		toggle,
	};
}
