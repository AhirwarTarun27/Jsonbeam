/**
 * The expandable JSON tree rendered by `/json-viewer` and `/json-tree-viewer`.
 *
 * Both islands drew the same widget from the same markup contract and the same
 * `styles/workbench/tree.css`, in ~400 lines each that agreed on all but one
 * thing: JsonTreeViewer implemented the WAI-ARIA tree keyboard pattern and
 * JsonViewer did not. That difference was not a design decision anyone made —
 * it was the older copy never catching up. And it was a real defect, because
 * JsonViewer still announced `role="tree"`: a screen-reader user was told
 * "tree" and then found the arrow keys did nothing.
 *
 * So the merge resolves toward the better copy rather than the common subset.
 * Everything here is one implementation; the pieces an island may not have —
 * the breadcrumb readout, a copy-path affordance — are optional inputs, so an
 * island that omits them simply gets no-ops (the same shape as `data-stats` in
 * status-bar).
 *
 * DOM contract, produced by this module and styled by `tree.css`:
 *
 *   [role="tree"]                        ← you pass this in
 *     [role="treeitem"][data-path]       ← .jb-row > .jb-toggle | .jb-key | …
 *       [role="group"].jb-children       ← lazily filled on first expand
 *
 * Large documents: children are materialised on first expand, and a single
 * container renders at most CHUNK siblings synchronously — past that it emits a
 * "Show more" button. Neither depth nor breadth can freeze the tab.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonTreeOptions {
	/** The `[role="tree"]` container. Owned by this module once passed. */
	tree: HTMLElement;
	/**
	 * Copy a node's path. The island decides how to report the outcome, because
	 * that is a status-bar concern and the status bar belongs to the island.
	 */
	onCopyPath?: (path: string) => void;
	/** Breadcrumb readout for the focused node. Absent in JsonViewer. */
	pathDisplay?: HTMLElement | null;
	/** Type/size suffix beside the breadcrumb, e.g. "· array · 3 items". */
	pathMeta?: HTMLElement | null;
}

export interface JsonTree {
	/** Replace the tree with a render of `value`. */
	render(value: JsonValue): void;
	/** Replace the tree with a single centred message row. */
	placeholder(message: string): void;
	expandAll(): void;
	collapseAll(): void;
	/** Path of the focused node; `'$'` when nothing is focused. */
	currentPath(): string;
}

/**
 * Auto-expand the first level only when the root is small enough that doing so
 * won't materialise a huge subtree (keeps the lazy strategy honest).
 */
const AUTO_EXPAND_MAX = 100;

/**
 * Never build more than this many sibling rows in one synchronous pass — wide
 * arrays/objects render the first chunk and a "Show more" control for the rest.
 */
const CHUNK = 1000;

/** Type-ahead buffer lifetime, per the ARIA authoring practices. */
const TYPEAHEAD_MS = 600;

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Build the caret SVG once at module scope and clone it per node — re-parsing
 * innerHTML for every row is a real cost at thousands of nodes.
 */
const CHEVRON_NODE = (() => {
	const host = document.createElement('span');
	host.innerHTML =
		'<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
	return host.firstElementChild;
})();

export function isJsonObject(v: JsonValue): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isJsonArray(v: JsonValue): v is JsonValue[] {
	return Array.isArray(v);
}

/** The one-line size readout the status bar shows for a whole document. */
export function topSummary(value: JsonValue): string {
	if (isJsonArray(value)) {
		const n = value.length;
		return `${n} ${n === 1 ? 'item' : 'items'}`;
	}
	if (isJsonObject(value)) {
		const n = Object.keys(value).length;
		return `${n} ${n === 1 ? 'key' : 'keys'}`;
	}
	return 'scalar';
}

function childPath(parent: string, key: string | number): string {
	if (typeof key === 'number') return `${parent}[${key}]`;
	return IDENT.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function entriesOf(value: JsonObject | JsonValue[]): [string | number, JsonValue][] {
	return isJsonArray(value)
		? value.map((v, i) => [i, v] as [number, JsonValue])
		: Object.entries(value);
}

/** What the breadcrumb says a node *is* — "array · 3 items", "string", "null". */
function metaOf(value: JsonValue): string {
	if (isJsonArray(value)) {
		const n = value.length;
		return `array · ${n} ${n === 1 ? 'item' : 'items'}`;
	}
	if (isJsonObject(value)) {
		const n = Object.keys(value).length;
		return `object · ${n} ${n === 1 ? 'key' : 'keys'}`;
	}
	if (value === null) return 'null';
	return typeof value; // string | number | boolean
}

/**
 * The tag matters: `.jb-children` and `.jb-placeholder` are styled as blocks
 * (border-left, padding), so they must not be inline. Rows and inline tokens
 * are spans.
 */
function el(tag: 'div' | 'span', className: string, text?: string): HTMLElement {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

const span = (className: string, text?: string): HTMLElement => el('span', className, text);
const div = (className: string, text?: string): HTMLElement => el('div', className, text);

function keySpan(key: string | number, path: string): HTMLElement {
	const el = span('jb-key', typeof key === 'number' ? String(key) : key);
	el.setAttribute('data-copy-path', '');
	el.setAttribute('data-path', path);
	el.setAttribute('title', `Copy path: ${path}`);
	return el;
}

function valueSpan(value: string | number | boolean | null): HTMLElement {
	const el = span('jb-val', JSON.stringify(value));
	if (typeof value === 'string') el.classList.add('jb-string');
	else if (typeof value === 'number') el.classList.add('jb-number');
	else if (typeof value === 'boolean') el.classList.add('jb-bool');
	else el.classList.add('jb-null');
	return el;
}

function summarySpan(value: JsonObject | JsonValue[]): HTMLElement {
	const el = span('jb-summary');
	el.setAttribute('data-toggle', '');
	if (isJsonArray(value)) {
		const n = value.length;
		el.textContent = n === 0 ? '[ ]' : `[ ${n} ${n === 1 ? 'item' : 'items'} ]`;
	} else {
		const n = Object.keys(value).length;
		el.textContent = n === 0 ? '{ }' : `{ ${n} ${n === 1 ? 'key' : 'keys'} }`;
	}
	return el;
}

export function createJsonTree(opts: JsonTreeOptions): JsonTree {
	const { tree, onCopyPath, pathDisplay = null, pathMeta = null } = opts;

	/** Per-container build closures — children materialise on first expand. */
	const builders = new WeakMap<HTMLElement, () => void>();

	// ── Build ────────────────────────────────────────────────────────────────

	/**
	 * Render entries [start, start+CHUNK) into a container; if more remain, add a
	 * "Show more" button that renders the next chunk on demand.
	 */
	function appendChildren(
		container: HTMLElement,
		entries: [string | number, JsonValue][],
		parentPath: string,
		start: number,
	): void {
		const end = Math.min(start + CHUNK, entries.length);
		const frag = document.createDocumentFragment();
		for (let i = start; i < end; i++) {
			const entry = entries[i];
			frag.appendChild(createItem(entry[0], entry[1], parentPath));
		}
		container.appendChild(frag);
		if (end < entries.length) {
			const remaining = entries.length - end;
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'jb-more';
			more.textContent = `Show ${Math.min(CHUNK, remaining)} more — ${remaining.toLocaleString()} left`;
			more.addEventListener('click', () => {
				more.remove();
				appendChildren(container, entries, parentPath, end);
			});
			container.appendChild(more);
		}
	}

	function createItem(key: string | number | null, value: JsonValue, parentPath: string): HTMLElement {
		const path = key === null ? parentPath : childPath(parentPath, key);
		const item = document.createElement('div');
		item.setAttribute('role', 'treeitem');
		// -1 by default: the tree is a single tab stop, and `setCurrent` promotes
		// exactly one node to 0 (the roving tabindex pattern).
		item.setAttribute('tabindex', '-1');
		item.dataset.path = path;
		item.dataset.meta = metaOf(value);
		if (key !== null) item.dataset.key = typeof key === 'number' ? String(key) : key;

		const row = div('jb-row');

		if (isJsonObject(value) || isJsonArray(value)) {
			item.setAttribute('aria-expanded', 'false');
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'jb-toggle';
			toggle.setAttribute('data-toggle', '');
			// The treeitem carries the tab stop, not its inner button — otherwise
			// Tab would walk every caret in the document.
			toggle.setAttribute('tabindex', '-1');
			toggle.setAttribute('aria-label', 'Expand');
			if (CHEVRON_NODE) toggle.appendChild(CHEVRON_NODE.cloneNode(true));
			row.appendChild(toggle);
			if (key !== null) {
				row.appendChild(keySpan(key, path));
				row.appendChild(span('jb-punct', ':'));
			}
			row.appendChild(summarySpan(value));

			const group = div('jb-children');
			group.setAttribute('role', 'group');
			group.hidden = true;

			item.appendChild(row);
			item.appendChild(group);

			const container = value;
			let built = false;
			builders.set(item, () => {
				if (built) return;
				built = true;
				appendChildren(group, entriesOf(container), path, 0);
			});
		} else {
			row.appendChild(span('jb-toggle jb-toggle--leaf'));
			if (key !== null) {
				row.appendChild(keySpan(key, path));
				row.appendChild(span('jb-punct', ':'));
			}
			row.appendChild(valueSpan(value));
			item.appendChild(row);
		}
		return item;
	}

	// ── Topology (shared by expand/collapse and keyboard nav) ─────────────────

	const isExpandable = (item: HTMLElement): boolean => item.hasAttribute('aria-expanded');
	const isExpanded = (item: HTMLElement): boolean => item.getAttribute('aria-expanded') === 'true';
	const childGroup = (item: HTMLElement): HTMLElement | null =>
		item.querySelector<HTMLElement>(':scope > .jb-children');

	function childItems(item: HTMLElement): HTMLElement[] {
		const group = childGroup(item);
		if (!group) return [];
		return Array.from(group.querySelectorAll<HTMLElement>(':scope > [role="treeitem"]'));
	}

	function siblingItem(item: HTMLElement, dir: 'next' | 'previous'): HTMLElement | null {
		let el: Element | null = dir === 'next' ? item.nextElementSibling : item.previousElementSibling;
		// Skip the "Show more" button, which is a sibling but not an item.
		while (el && el.getAttribute('role') !== 'treeitem') {
			el = dir === 'next' ? el.nextElementSibling : el.previousElementSibling;
		}
		return el as HTMLElement | null;
	}

	function parentItem(item: HTMLElement): HTMLElement | null {
		const group = item.parentElement;
		if (!group || !group.classList.contains('jb-children')) return null;
		const parent = group.parentElement;
		return parent && parent.getAttribute('role') === 'treeitem' ? parent : null;
	}

	function deepestVisible(item: HTMLElement): HTMLElement {
		let cur = item;
		while (isExpandable(cur) && isExpanded(cur)) {
			const kids = childItems(cur);
			if (kids.length === 0) break;
			cur = kids[kids.length - 1];
		}
		return cur;
	}

	function nextVisible(item: HTMLElement): HTMLElement | null {
		if (isExpandable(item) && isExpanded(item)) {
			const kids = childItems(item);
			if (kids.length > 0) return kids[0];
		}
		let cur: HTMLElement | null = item;
		while (cur) {
			const sib = siblingItem(cur, 'next');
			if (sib) return sib;
			cur = parentItem(cur);
		}
		return null;
	}

	function prevVisible(item: HTMLElement): HTMLElement | null {
		const sib = siblingItem(item, 'previous');
		if (sib) return deepestVisible(sib);
		return parentItem(item);
	}

	const firstItem = (): HTMLElement | null => tree.querySelector<HTMLElement>(':scope > [role="treeitem"]');

	function lastVisibleItem(): HTMLElement | null {
		const roots = tree.querySelectorAll<HTMLElement>(':scope > [role="treeitem"]');
		const last = roots[roots.length - 1];
		return last ? deepestVisible(last) : null;
	}

	// ── Roving focus + breadcrumb ─────────────────────────────────────────────

	let current: HTMLElement | null = null;

	function updateBreadcrumb(item: HTMLElement | null): void {
		if (!pathDisplay || !pathMeta) return;
		pathDisplay.textContent = item?.dataset.path ?? '$';
		pathMeta.textContent = item ? `· ${item.dataset.meta ?? ''}` : '';
	}

	function setCurrent(item: HTMLElement | null, focus = true): void {
		if (current && current !== item) {
			current.setAttribute('tabindex', '-1');
			current.removeAttribute('aria-selected');
		}
		current = item;
		if (!item) {
			updateBreadcrumb(null);
			return;
		}
		item.setAttribute('tabindex', '0');
		item.setAttribute('aria-selected', 'true');
		if (focus) item.focus();
		updateBreadcrumb(item);
	}

	// ── Expand / collapse ─────────────────────────────────────────────────────

	function toggleItem(item: HTMLElement, expand?: boolean): void {
		const group = childGroup(item);
		if (!group) return;
		const next = expand === undefined ? !isExpanded(item) : expand;
		if (next) builders.get(item)?.();
		group.hidden = !next;
		item.setAttribute('aria-expanded', String(next));
		const toggle = item.querySelector<HTMLElement>(':scope > .jb-row > .jb-toggle');
		toggle?.setAttribute('aria-label', next ? 'Collapse' : 'Expand');
	}

	function expandTopLevel(): void {
		tree
			.querySelectorAll<HTMLElement>(':scope > [role="treeitem"][aria-expanded="false"]')
			.forEach((item) => toggleItem(item, true));
	}

	function expandAll(): void {
		// Each pass materialises one more level, so loop until nothing is
		// collapsed. The guard is a safety net, not an expected bound.
		let guard = 0;
		while (guard < 100000) {
			const collapsed = tree.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="false"]');
			if (collapsed.length === 0) break;
			collapsed.forEach((item) => toggleItem(item, true));
			guard++;
		}
	}

	function collapseAll(): void {
		tree
			.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="true"]')
			.forEach((item) => toggleItem(item, false));
		// Focus may have lived inside a now-collapsed branch — pull it to a root.
		if (current && (!current.isConnected || parentItem(current))) {
			setCurrent(firstItem(), false);
		}
	}

	// ── Render ────────────────────────────────────────────────────────────────

	function placeholder(message: string): void {
		tree.replaceChildren();
		current = null;
		updateBreadcrumb(null);
		tree.appendChild(div('jb-placeholder', message));
	}

	function render(value: JsonValue): void {
		tree.replaceChildren();
		current = null;
		if (isJsonObject(value) || isJsonArray(value)) {
			const entries = entriesOf(value);
			if (entries.length === 0) {
				placeholder(isJsonArray(value) ? 'Empty array — [ ]' : 'Empty object — { }');
				return;
			}
			appendChildren(tree, entries, '$', 0);
			if (entries.length <= AUTO_EXPAND_MAX) expandTopLevel();
		} else {
			tree.appendChild(createItem(null, value, '$'));
		}
		// Seed the roving tab stop on the first node (no focus steal on load).
		setCurrent(firstItem(), false);
	}

	// ── Keyboard (WAI-ARIA tree pattern) ──────────────────────────────────────

	let typeBuffer = '';
	let typeTimer = 0;

	function typeAhead(char: string): void {
		clearTimeout(typeTimer);
		typeBuffer += char.toLowerCase();
		typeTimer = window.setTimeout(() => {
			typeBuffer = '';
		}, TYPEAHEAD_MS);

		// Walk visible items starting just after the current one, wrapping once.
		const start = current ?? firstItem();
		if (!start) return;
		let node: HTMLElement | null = start;
		let guard = 0;
		const visited: HTMLElement[] = [];
		while (node && guard < 20000) {
			visited.push(node);
			node = nextVisible(node);
			guard++;
		}
		// Continue from the top so search wraps around.
		let head: HTMLElement | null = firstItem();
		while (head && head !== start && guard < 40000) {
			visited.push(head);
			head = nextVisible(head);
			guard++;
		}
		for (const candidate of visited) {
			if (candidate === start) continue;
			const key = (candidate.dataset.key ?? '').toLowerCase();
			if (key.startsWith(typeBuffer)) {
				setCurrent(candidate);
				return;
			}
		}
	}

	const copyPath = (path: string): void => onCopyPath?.(path);

	tree.addEventListener('keydown', (e: KeyboardEvent) => {
		const item = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
		if (!item) return;

		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				const n = nextVisible(item);
				if (n) setCurrent(n);
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				const p = prevVisible(item);
				if (p) setCurrent(p);
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				if (isExpandable(item) && !isExpanded(item)) {
					toggleItem(item, true);
				} else if (isExpandable(item) && isExpanded(item)) {
					const kids = childItems(item);
					if (kids.length) setCurrent(kids[0]);
				}
				break;
			}
			case 'ArrowLeft': {
				e.preventDefault();
				if (isExpandable(item) && isExpanded(item)) {
					toggleItem(item, false);
				} else {
					const parent = parentItem(item);
					if (parent) setCurrent(parent);
				}
				break;
			}
			case 'Home': {
				e.preventDefault();
				const f = firstItem();
				if (f) setCurrent(f);
				break;
			}
			case 'End': {
				e.preventDefault();
				const l = lastVisibleItem();
				if (l) setCurrent(l);
				break;
			}
			case 'Enter':
			case ' ': {
				e.preventDefault();
				if (isExpandable(item)) toggleItem(item);
				else copyPath(item.dataset.path ?? '');
				break;
			}
			case 'c':
			case 'C': {
				if (e.metaKey || e.ctrlKey) return; // let native copy work
				e.preventDefault();
				copyPath(item.dataset.path ?? '');
				break;
			}
			default: {
				if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
					e.preventDefault();
					typeAhead(e.key);
				}
			}
		}
	});

	// One delegated listener for the whole tree: copy-path beats toggle, and any
	// click updates the roving focus so keyboard nav resumes where the mouse left.
	tree.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		const item = target.closest<HTMLElement>('[role="treeitem"]');
		const copyEl = target.closest<HTMLElement>('[data-copy-path]');
		if (copyEl) {
			if (item) setCurrent(item, false);
			copyPath(copyEl.getAttribute('data-path') ?? '');
			return;
		}
		if (item && target.closest<HTMLElement>('[data-toggle]')) {
			setCurrent(item, false);
			toggleItem(item);
			return;
		}
		if (item) setCurrent(item);
	});

	return {
		render,
		placeholder,
		expandAll,
		collapseAll,
		currentPath: () => current?.dataset.path ?? '$',
	};
}
