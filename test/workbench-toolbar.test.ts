// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { bindActions, flashLabel } from '../src/lib/workbench/toolbar';
import { FLASH_MS } from '../src/lib/workbench/timing';

afterEach(() => {
	document.body.innerHTML = '';
	vi.useRealTimers();
});

function mount(html: string): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = html;
	document.body.appendChild(root);
	return root;
}

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('bindActions', () => {
	it('routes a click to the handler named by data-action', () => {
		const root = mount('<button data-action="copy">Copy</button>');
		const copy = vi.fn();
		bindActions(root, { copy });

		click(root.querySelector('button')!);
		expect(copy).toHaveBeenCalledTimes(1);
	});

	it('passes the acting element, so handlers can read its dataset', () => {
		const root = mount('<button data-action="tab" data-mode="tree">Tree</button>');
		const tab = vi.fn();
		bindActions(root, { tab });

		click(root.querySelector('button')!);
		expect(tab.mock.calls[0][0].dataset.mode).toBe('tree');
	});

	it('finds the action on an ancestor when the click lands on an inner node', () => {
		// Every toolbar button wraps an <svg>; the event target is the icon.
		const root = mount('<button data-action="expand"><svg><path/></svg></button>');
		const expand = vi.fn();
		bindActions(root, { expand });

		click(root.querySelector('path')!);
		expect(expand).toHaveBeenCalledTimes(1);
	});

	it('picks the nearest action when they nest', () => {
		const root = mount('<div data-action="outer"><button data-action="inner">x</button></div>');
		const outer = vi.fn();
		const inner = vi.fn();
		bindActions(root, { outer, inner });

		click(root.querySelector('button')!);
		expect(inner).toHaveBeenCalledTimes(1);
		expect(outer).not.toHaveBeenCalled();
	});

	it('covers controls added after binding', () => {
		// This is the reason for delegation over a mount-time querySelectorAll:
		// the diff navigator and the table filter row appear later.
		const root = mount('');
		const late = vi.fn();
		bindActions(root, { late });

		root.innerHTML = '<button data-action="late">Later</button>';
		click(root.querySelector('button')!);
		expect(late).toHaveBeenCalledTimes(1);
	});

	it('ignores clicks with no action and unknown actions', () => {
		const root = mount('<button>plain</button><button data-action="ghost">?</button>');
		const onUnknown = vi.fn();
		bindActions(root, {}, { onUnknown });

		click(root.querySelectorAll('button')[0]);
		expect(onUnknown).not.toHaveBeenCalled();

		click(root.querySelectorAll('button')[1]);
		expect(onUnknown).toHaveBeenCalledWith('ghost', expect.any(HTMLElement));
	});

	it('does not fire for another island’s buttons', () => {
		// Two islands can share a page; the copies that listened on `document`
		// would cross-fire here.
		const a = mount('<button data-action="run">A</button>');
		const b = mount('<button data-action="run">B</button>');
		const runA = vi.fn();
		bindActions(a, { run: runA });

		click(b.querySelector('button')!);
		expect(runA).not.toHaveBeenCalled();

		click(a.querySelector('button')!);
		expect(runA).toHaveBeenCalledTimes(1);
	});

	it('unbinds cleanly', () => {
		const root = mount('<button data-action="copy">Copy</button>');
		const copy = vi.fn();
		const unbind = bindActions(root, { copy });

		unbind();
		click(root.querySelector('button')!);
		expect(copy).not.toHaveBeenCalled();
	});
});

describe('flashLabel', () => {
	const button = (text: string): HTMLElement => {
		const el = document.createElement('button');
		el.textContent = text;
		document.body.appendChild(el);
		return el;
	};

	it('swaps the label and restores it after the flash window', () => {
		vi.useFakeTimers();
		const el = button('Copy');

		flashLabel(el, 'Copied!');
		expect(el.textContent).toBe('Copied!');

		vi.advanceTimersByTime(FLASH_MS - 1);
		expect(el.textContent).toBe('Copied!');

		vi.advanceTimersByTime(1);
		expect(el.textContent).toBe('Copy');
	});

	it('restores the FIRST label when flashed again mid-flash', () => {
		// The bug in all three inline copies: a second click read the already-
		// swapped text as the "original", so the button said Copied! forever.
		vi.useFakeTimers();
		const el = button('Copy');

		flashLabel(el, 'Copied!');
		vi.advanceTimersByTime(FLASH_MS / 2);
		flashLabel(el, 'Copied!');

		// The first timer's deadline passes — it must not restore early either.
		vi.advanceTimersByTime(FLASH_MS / 2);
		expect(el.textContent).toBe('Copied!');

		vi.advanceTimersByTime(FLASH_MS / 2);
		expect(el.textContent).toBe('Copy');
	});

	it('keeps each control’s label independent', () => {
		vi.useFakeTimers();
		const copy = button('Copy');
		const download = button('Download');

		flashLabel(copy, 'Copied!');
		flashLabel(download, 'Saved');
		vi.advanceTimersByTime(FLASH_MS);

		expect(copy.textContent).toBe('Copy');
		expect(download.textContent).toBe('Download');
	});

	it('accepts a custom duration', () => {
		vi.useFakeTimers();
		const el = button('Copy');

		flashLabel(el, 'Copied!', 100);
		vi.advanceTimersByTime(100);
		expect(el.textContent).toBe('Copy');
	});
});
