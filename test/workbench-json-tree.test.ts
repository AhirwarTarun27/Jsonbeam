// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createJsonTree, topSummary, type JsonTree, type JsonValue } from '../src/lib/workbench/json-tree';

let host: HTMLElement;
let tree: JsonTree;

/**
 * Mount a fresh tree on a fresh container.
 *
 * Always a NEW host: `createJsonTree` attaches its own click/keydown listeners,
 * so binding twice to one container makes every key toggle twice.
 */
function mount(opts: Omit<Parameters<typeof createJsonTree>[0], 'tree'> = {}): JsonTree {
	host = document.createElement('div');
	host.setAttribute('role', 'tree');
	document.body.appendChild(host);
	tree = createJsonTree({ tree: host, ...opts });
	return tree;
}

beforeEach(() => {
	mount();
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.useRealTimers();
});

const items = (scope: ParentNode = host) =>
	Array.from(scope.querySelectorAll<HTMLElement>('[role="treeitem"]'));
const roots = () => Array.from(host.querySelectorAll<HTMLElement>(':scope > [role="treeitem"]'));
const paths = () => items().map((i) => i.dataset.path);
const rowText = (item: HTMLElement) => item.querySelector('.jb-row')!.textContent;

const key = (k: string, opts: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });

describe('createJsonTree — rendering', () => {
	it('builds one treeitem per entry with a JSONPath', () => {
		tree.render({ a: 1, b: 'two' });
		expect(paths()).toEqual(['$.a', '$.b']);
	});

	it('brackets keys that are not identifiers, and indexes arrays', () => {
		tree.render({ 'not-ident': [10, 20] });
		tree.expandAll();
		expect(paths()).toEqual(['$["not-ident"]', '$["not-ident"][0]', '$["not-ident"][1]']);
	});

	it('classes leaves by JSON type so the syntax palette can colour them', () => {
		tree.render({ s: 'x', n: 1, b: true, z: null });
		const classes = items().map((i) => i.querySelector('.jb-val')!.className);
		expect(classes).toEqual([
			'jb-val jb-string',
			'jb-val jb-number',
			'jb-val jb-bool',
			'jb-val jb-null',
		]);
	});

	it('renders a bare scalar document as a single row', () => {
		tree.render(42);
		expect(roots()).toHaveLength(1);
		expect(paths()).toEqual(['$']);
	});

	it('shows a placeholder for empty containers rather than an empty pane', () => {
		tree.render([]);
		expect(host.querySelector('.jb-placeholder')!.textContent).toBe('Empty array — [ ]');
		tree.render({});
		expect(host.querySelector('.jb-placeholder')!.textContent).toBe('Empty object — { }');
	});

	it('replaces the previous document on re-render', () => {
		tree.render({ old: 1 });
		tree.render({ fresh: 1 });
		expect(paths()).toEqual(['$.fresh']);
	});

	it('uses block elements for the nested group and placeholder', () => {
		// `.jb-children` carries a border-left and padding; inline would collapse it.
		tree.render({ nest: { a: 1 } });
		expect(host.querySelector('.jb-children')!.tagName).toBe('DIV');
		tree.placeholder('nothing here');
		expect(host.querySelector('.jb-placeholder')!.tagName).toBe('DIV');
	});
});

describe('createJsonTree — lazy materialisation', () => {
	it('does not build a subtree until it is first expanded', () => {
		// Deep enough that auto-expand of the top level stops one level in.
		tree.render({ outer: { inner: { leaf: 1 } } });

		const outer = roots()[0];
		const innerGroup = outer.querySelector<HTMLElement>(':scope > .jb-children')!;
		const inner = innerGroup.querySelector<HTMLElement>(':scope > [role="treeitem"]')!;
		// `inner` exists (its parent was auto-expanded) but its own children do not.
		expect(inner.querySelector('.jb-children')!.childElementCount).toBe(0);

		inner.querySelector<HTMLElement>('.jb-toggle')!.click();
		expect(inner.querySelector('.jb-children')!.childElementCount).toBe(1);
	});

	it('caps a wide container at one chunk and offers the rest on demand', () => {
		tree.render({ wide: Array.from({ length: 1500 }, (_, i) => i) });
		roots()[0].querySelector<HTMLElement>('.jb-toggle')!.click();

		const group = roots()[0].querySelector<HTMLElement>('.jb-children')!;
		expect(items(group)).toHaveLength(1000);

		const more = group.querySelector<HTMLButtonElement>('.jb-more')!;
		expect(more.textContent).toBe('Show 500 more — 500 left');

		more.click();
		expect(items(group)).toHaveLength(1500);
		expect(group.querySelector('.jb-more')).toBeNull();
	});

	it('auto-expands the top level only up to the safety cap', () => {
		tree.render(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { v: i }])));
		expect(roots()[0].getAttribute('aria-expanded')).toBe('true');

		tree.render(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, { v: i }])));
		expect(roots()[0].getAttribute('aria-expanded')).toBe('false');
	});
});

describe('createJsonTree — expand and collapse', () => {
	const nested: JsonValue = { a: { b: { c: { d: 1 } } } };

	it('expandAll reaches every level, including lazily built ones', () => {
		tree.render(nested);
		tree.expandAll();
		expect(paths()).toEqual(['$.a', '$.a.b', '$.a.b.c', '$.a.b.c.d']);
		expect(items().filter((i) => i.getAttribute('aria-expanded') === 'false')).toHaveLength(0);
	});

	it('collapseAll closes every branch', () => {
		tree.render(nested);
		tree.expandAll();
		tree.collapseAll();
		expect(items().filter((i) => i.getAttribute('aria-expanded') === 'true')).toHaveLength(0);
	});

	it('collapseAll pulls focus back to a root when it was inside a branch', () => {
		tree.render(nested);
		tree.expandAll();

		const deep = items().find((i) => i.dataset.path === '$.a.b')!;
		deep.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(tree.currentPath()).toBe('$.a.b');

		tree.collapseAll();
		// Otherwise the tab stop would sit on a node inside a hidden group.
		expect(tree.currentPath()).toBe('$.a');
	});

	it('keeps the caret label in step with the state', () => {
		tree.render({ a: { b: 1 } });
		const toggle = roots()[0].querySelector<HTMLElement>('.jb-toggle')!;
		expect(toggle.getAttribute('aria-label')).toBe('Collapse'); // auto-expanded
		toggle.click();
		expect(toggle.getAttribute('aria-label')).toBe('Expand');
	});
});

describe('createJsonTree — roving focus', () => {
	it('seeds exactly one tab stop without stealing focus', () => {
		tree.render({ a: 1, b: 2 });
		expect(items().map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1']);
		expect(document.activeElement).toBe(document.body);
	});

	it('moves the tab stop with the arrow keys', () => {
		tree.render({ a: 1, b: 2, c: 3 });
		const [a, b] = items();

		a.dispatchEvent(key('ArrowDown'));
		expect(tree.currentPath()).toBe('$.b');
		expect(b.getAttribute('tabindex')).toBe('0');
		expect(a.getAttribute('tabindex')).toBe('-1');

		b.dispatchEvent(key('ArrowUp'));
		expect(tree.currentPath()).toBe('$.a');
	});

	it('ArrowDown descends into an expanded branch', () => {
		tree.render({ a: { inner: 1 }, b: 2 });
		roots()[0].dispatchEvent(key('ArrowDown'));
		expect(tree.currentPath()).toBe('$.a.inner');
	});

	it('ArrowRight expands, then steps into the first child', () => {
		tree.render({ a: { b: { c: 1 } } });
		const a = roots()[0];
		const b = items().find((i) => i.dataset.path === '$.a.b')!;

		expect(b.getAttribute('aria-expanded')).toBe('false');
		b.dispatchEvent(key('ArrowRight'));
		expect(b.getAttribute('aria-expanded')).toBe('true');

		b.dispatchEvent(key('ArrowRight'));
		expect(tree.currentPath()).toBe('$.a.b.c');
		expect(a).toBeTruthy();
	});

	it('ArrowLeft collapses, then steps out to the parent', () => {
		tree.render({ a: { b: 1 } });
		const a = roots()[0];

		a.dispatchEvent(key('ArrowLeft'));
		expect(a.getAttribute('aria-expanded')).toBe('false');

		const child = items().find((i) => i.dataset.path === '$.a.b')!;
		child.dispatchEvent(key('ArrowLeft'));
		expect(tree.currentPath()).toBe('$.a');
	});

	it('Home and End jump to the first and last visible nodes', () => {
		tree.render({ a: 1, z: { deep: 2 } });
		const a = roots()[0];

		a.dispatchEvent(key('End'));
		expect(tree.currentPath()).toBe('$.z.deep');

		items().find((i) => i.dataset.path === '$.z.deep')!.dispatchEvent(key('Home'));
		expect(tree.currentPath()).toBe('$.a');
	});

	it('type-ahead jumps to the next key with a matching prefix', () => {
		vi.useFakeTimers();
		tree.render({ alpha: 1, beta: 2, gamma: 3 });

		roots()[0].dispatchEvent(key('g'));
		expect(tree.currentPath()).toBe('$.gamma');

		// The buffer must expire, or a later "b" would search for "gb".
		vi.advanceTimersByTime(600);
		items().find((i) => i.dataset.path === '$.gamma')!.dispatchEvent(key('b'));
		expect(tree.currentPath()).toBe('$.beta');
	});

	it('leaves Ctrl/Cmd combinations to the browser', () => {
		const copied: string[] = [];
		mount({ onCopyPath: (p) => copied.push(p) }).render({ a: 1 });

		const ev = key('c', { ctrlKey: true });
		roots()[0].dispatchEvent(ev);
		expect(copied).toEqual([]);
		expect(ev.defaultPrevented).toBe(false);

		// Bare "c" is the copy-path shortcut, so the guard is load-bearing.
		roots()[0].dispatchEvent(key('c'));
		expect(copied).toEqual(['$.a']);
	});
});

describe('createJsonTree — copy path', () => {
	it('reports the clicked key’s path and does not toggle the branch', () => {
		const copied: string[] = [];
		mount({ onCopyPath: (p) => copied.push(p) }).render({ a: { b: 1 } });

		const branch = roots()[0];
		branch.querySelector<HTMLElement>('.jb-key')!.click();

		expect(copied).toEqual(['$.a']);
		expect(branch.getAttribute('aria-expanded')).toBe('true'); // unchanged
	});

	it('copies the focused path on Enter for a leaf, and toggles for a branch', () => {
		const copied: string[] = [];
		mount({ onCopyPath: (p) => copied.push(p) }).render({ a: { b: 1 } });

		const leaf = items().find((i) => i.dataset.path === '$.a.b')!;
		leaf.dispatchEvent(key('Enter'));
		expect(copied).toEqual(['$.a.b']);

		const branch = roots()[0];
		branch.dispatchEvent(key('Enter'));
		expect(branch.getAttribute('aria-expanded')).toBe('false');
		expect(copied).toEqual(['$.a.b']); // no extra copy
	});

	it('currentPath falls back to $ before anything is rendered', () => {
		expect(tree.currentPath()).toBe('$');
	});
});

describe('createJsonTree — optional breadcrumb', () => {
	it('tracks the focused node when the elements are supplied', () => {
		const display = document.createElement('code');
		const meta = document.createElement('span');
		document.body.append(display, meta);
		const t = mount({ pathDisplay: display, pathMeta: meta });

		t.render({ list: [1, 2, 3], name: 'x' });
		expect(display.textContent).toBe('$.list');
		expect(meta.textContent).toBe('· array · 3 items');

		// End walks to the last visible node — Enter on a leaf copies, it does
		// not move focus, so it would not exercise the breadcrumb.
		roots()[0].dispatchEvent(key('End'));
		expect(display.textContent).toBe('$.name');
		expect(meta.textContent).toBe('· string');

		t.placeholder('empty');
		expect(display.textContent).toBe('$');
		expect(meta.textContent).toBe('');
	});

	it('is a no-op for an island that has no breadcrumb', () => {
		// JsonViewer passes neither; rendering must not throw.
		expect(() => tree.render({ a: 1 })).not.toThrow();
	});
});

describe('topSummary', () => {
	it('describes the document for the status bar, singular-aware', () => {
		expect(topSummary([1])).toBe('1 item');
		expect(topSummary([1, 2])).toBe('2 items');
		expect(topSummary({ a: 1 })).toBe('1 key');
		expect(topSummary({ a: 1, b: 2 })).toBe('2 keys');
		expect(topSummary('scalar value')).toBe('scalar');
		expect(topSummary(null)).toBe('scalar');
	});
});
