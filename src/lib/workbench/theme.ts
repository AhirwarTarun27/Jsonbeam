/**
 * Shared dark/light theme toggle for the tool islands.
 *
 * Before this module, all eight islands hand-rolled identical copies of the
 * theme read/write/paint logic plus the sun/moon SVGs — and the copies drifted
 * (two islands once shipped an unguarded `localStorage` read that crashed the
 * whole island in storage-blocked contexts). One module, one behavior, every
 * tool. This is the first slice of the shared island core the unified `/editor`
 * will be built on.
 *
 * Privacy law (CLAUDE.md): the only thing persisted is the `jb-theme`
 * preference (`'dark' | 'light'`) in `localStorage` — never user data. Every
 * access is guarded so a sandboxed iframe or blocked-cookie context (exactly
 * the privacy-hardened users this product targets) still gets a working tool.
 */

export type Theme = 'dark' | 'light';

const KEY = 'jb-theme';

/** Read the persisted theme. Defaults to dark — the on-brand editor surface. */
export function getTheme(): Theme {
	try {
		return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
	} catch {
		// Storage blocked (private mode / sandboxed iframe) — the default applies.
		return 'dark';
	}
}

/** Persist the theme. A blocked write is non-fatal — the choice stays in memory. */
export function setTheme(mode: Theme): void {
	try {
		localStorage.setItem(KEY, mode);
	} catch {
		/* storage blocked — keep the choice for this session only */
	}
}

/**
 * The toggle icon shows the theme you'll switch *to*: a sun while dark, a moon
 * while light. Both carry `aria-hidden` — the button itself owns the label.
 */
export const ICON_SUN =
	'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
export const ICON_MOON =
	'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"></path></svg>';

/** Handle returned by {@link initThemeToggle}. */
export interface ThemeToggle {
	/** The live theme. */
	readonly mode: Theme;
	/** Switch to a specific theme (persists + repaints + runs `onApply`). */
	set(mode: Theme): void;
	/** Flip between dark and light. Wire this to your toolbar's theme action. */
	toggle(): void;
}

export interface ThemeToggleOptions {
	/** Scope for locating the toggle button (typically the island root). */
	root: HTMLElement;
	/** The toggle button. Defaults to `[data-action="theme"]` within `root`. */
	button?: HTMLElement | null;
	/** The icon holder. Defaults to `[data-theme-icon]` within `button`. */
	icon?: HTMLElement | null;
	/**
	 * Runs after every paint (initial render + each change) with the active
	 * theme. Use for island-specific work: the formatter reconfigures its
	 * CodeMirror theme compartment here; the graph recolors its palette and
	 * redraws.
	 */
	onApply?: (mode: Theme) => void;
}

/**
 * Wire a tool island's dark/light toggle: paints the icon + aria-label, toggles
 * `.jb-theme-light` on `<html>` (a single site-wide signal applied before paint
 * by the layout's boot script, so a chosen light theme never flashes dark),
 * persists the choice, and keeps in sync across tabs via the `storage` event.
 * The caller owns the button's click wiring —
 * call the returned `toggle()` from your existing toolbar handler so each
 * island keeps a single dispatch path. Returns a handle exposing the live
 * `mode` plus programmatic `set` / `toggle`.
 */
export function initThemeToggle(opts: ThemeToggleOptions): ThemeToggle {
	const { root, onApply } = opts;
	const button = opts.button ?? root.querySelector<HTMLElement>('[data-action="theme"]');
	const icon = opts.icon ?? button?.querySelector<HTMLElement>('[data-theme-icon]') ?? null;

	let mode: Theme = getTheme();

	function paint(): void {
		if (icon) icon.innerHTML = mode === 'dark' ? ICON_SUN : ICON_MOON;
		button?.setAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
		document.documentElement.classList.toggle('jb-theme-light', mode === 'light');
		onApply?.(mode);
	}

	function set(next: Theme): void {
		mode = next;
		setTheme(mode);
		paint();
	}

	// Cross-tab sync: another tab toggled the shared preference.
	window.addEventListener('storage', (e) => {
		if (e.key === KEY) {
			mode = getTheme();
			paint();
		}
	});

	paint();

	return {
		get mode() {
			return mode;
		},
		set,
		toggle: () => set(mode === 'dark' ? 'light' : 'dark'),
	};
}
