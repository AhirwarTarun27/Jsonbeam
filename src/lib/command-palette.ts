/**
 * Command palette (⌘K / Ctrl K) — jump to any tool from anywhere in the app.
 *
 * Lazy-loaded: this whole module (and the DOM it builds) is imported only on the
 * first activation, so it never touches the editor route's initial text-mode
 * budget. Selecting a tool is a plain in-app navigation, so the working document
 * (lib/doc-store) carries to the destination automatically — paste once, jump
 * anywhere.
 *
 * Built on a native <dialog> + showModal(): focus trap, Esc-to-close, top-layer
 * stacking, and an inert background all come for free; we layer combobox/listbox
 * ARIA and arrow-key navigation on top.
 */
import { TOOL_NAV } from '../consts';

interface PaletteItem {
	label: string;
	href: string;
	group: string;
	soon: boolean;
}

export interface PaletteApi {
	open: () => void;
	close: () => void;
	toggle: () => void;
}

export function createPalette(): PaletteApi {
	const ALL: PaletteItem[] = TOOL_NAV.flatMap((g) =>
		g.items.map((it) => ({ label: it.label, href: it.href, group: g.title, soon: it.soon === true })),
	);
	const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

	// ── DOM ──────────────────────────────────────────────────────────────────
	const dialog = document.createElement('dialog');
	dialog.className = 'jb-cmdk';
	dialog.setAttribute('aria-label', 'Search tools');

	const box = document.createElement('div');
	box.className = 'jb-cmdk-box';

	const field = document.createElement('div');
	field.className = 'jb-cmdk-field';
	field.innerHTML =
		'<svg class="jb-cmdk-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'jb-cmdk-input';
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-expanded', 'true');
	input.setAttribute('aria-controls', 'jb-cmdk-list');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-label', 'Search tools');
	input.placeholder = 'Search tools…';
	input.autocomplete = 'off';
	input.spellcheck = false;
	field.appendChild(input);

	const list = document.createElement('ul');
	list.className = 'jb-cmdk-list';
	list.id = 'jb-cmdk-list';
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', 'Tools');

	const empty = document.createElement('div');
	empty.className = 'jb-cmdk-empty';
	empty.textContent = 'No matching tools.';
	empty.hidden = true;

	const footer = document.createElement('div');
	footer.className = 'jb-cmdk-footer';
	footer.innerHTML =
		'<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><span class="jb-cmdk-foot-note">JSON carries over</span>';

	box.append(field, list, empty, footer);
	dialog.appendChild(box);
	document.body.appendChild(dialog);

	// ── Filtering + rendering ─────────────────────────────────────────────────
	let results: PaletteItem[] = [];
	let active = 0;
	const rows: HTMLLIElement[] = [];

	function escapeRe(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function score(item: PaletteItem, q: string): number {
		if (q === '') return 0;
		const label = item.label.toLowerCase();
		const hay = `${item.label} ${item.group}`.toLowerCase();
		if (label.startsWith(q)) return 3;
		if (new RegExp(`\\b${escapeRe(q)}`).test(hay)) return 2;
		if (hay.includes(q)) return 1;
		return -1;
	}

	function render(): void {
		const q = input.value.trim().toLowerCase();
		results = ALL.map((item) => ({ item, s: score(item, q) }))
			.filter((r) => r.s >= 0)
			// Live tools before "soon"; then by match strength; otherwise stable.
			.sort((a, b) => Number(a.item.soon) - Number(b.item.soon) || b.s - a.s)
			.map((r) => r.item);

		list.replaceChildren();
		rows.length = 0;
		results.forEach((item, i) => {
			const li = document.createElement('li');
			li.id = `jb-cmdk-opt-${i}`;
			li.className = 'jb-cmdk-opt';
			li.setAttribute('role', 'option');
			if (item.soon) li.setAttribute('aria-disabled', 'true');
			const isCurrent = item.href.replace(/\/+$/, '') === currentPath;

			const label = document.createElement('span');
			label.className = 'jb-cmdk-opt-label';
			label.textContent = item.label;
			const tag = document.createElement('span');
			tag.className = 'jb-cmdk-opt-tag';
			tag.textContent = item.soon ? 'Soon' : isCurrent ? 'Current' : item.group;
			li.append(label, tag);

			li.addEventListener('click', () => choose(i));
			li.addEventListener('mousemove', () => setActive(i));
			rows.push(li);
			list.appendChild(li);
		});

		// Highlight the first selectable (non-"soon") row, or none if all are soon.
		active = results.findIndex((r) => !r.soon);
		empty.hidden = results.length > 0;
		list.hidden = results.length === 0;
		paintActive();
	}

	function paintActive(scroll = false): void {
		rows.forEach((li, i) => {
			const on = i === active;
			li.classList.toggle('is-active', on);
			li.setAttribute('aria-selected', String(on));
			if (on) input.setAttribute('aria-activedescendant', li.id);
		});
		if (active < 0) input.removeAttribute('aria-activedescendant');
		else if (scroll) rows[active]?.scrollIntoView({ block: 'nearest' });
	}

	function setActive(i: number): void {
		if (i < 0 || i >= results.length || results[i].soon) return;
		active = i;
		paintActive();
	}

	function move(delta: number): void {
		if (results.length === 0) return;
		let next = active;
		for (let n = 0; n < results.length; n++) {
			next = (next + delta + results.length) % results.length;
			if (!results[next].soon) {
				// step over "soon" rows; only commit when a selectable row is found
				active = next;
				paintActive(true);
				return;
			}
		}
	}

	function choose(i: number): void {
		const item = results[i];
		if (!item || item.soon) return;
		if (item.href.replace(/\/+$/, '') === currentPath) {
			close();
			return;
		}
		// Plain navigation — the working doc rides along via sessionStorage.
		window.location.href = item.href;
	}

	// ── Events ─────────────────────────────────────────────────────────────────
	input.addEventListener('input', render);
	input.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			move(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			move(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(active);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			move(e.shiftKey ? -1 : 1);
		}
	});

	// Click on the ::backdrop (target is the <dialog> itself) closes.
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) close();
	});

	function open(): void {
		if (dialog.open) return;
		input.value = '';
		render();
		dialog.showModal();
		input.focus();
	}
	function close(): void {
		if (dialog.open) dialog.close();
	}
	function toggle(): void {
		if (dialog.open) close();
		else open();
	}

	return { open, close, toggle };
}
