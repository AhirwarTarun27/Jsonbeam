// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createStatusBar } from '../src/lib/workbench/status-bar';
import { FLASH_MS } from '../src/lib/workbench/timing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The status-bar markup every island renders. */
function mount(opts: { stats?: boolean; decoyDot?: boolean } = {}): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = `
		${opts.decoyDot ? '<svg><circle data-dot></circle></svg>' : ''}
		<span role="status" aria-live="polite">
			<span class="h-2 w-2 rounded-full bg-mute" data-dot></span>
			<span data-label>Ready</span>
		</span>
		${opts.stats ? '<span data-stats></span>' : ''}
	`;
	document.body.appendChild(root);
	return root;
}

afterEach(() => {
	document.body.innerHTML = '';
});

const dotOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="status"] [data-dot]')!;
const labelOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-label]')!;

describe('createStatusBar / set', () => {
	it('paints the dot and label from design tokens, not literals', () => {
		const root = mount();
		const bar = createStatusBar(root);

		bar.set('ok', 'Valid JSON');
		expect(dotOf(root).style.backgroundColor).toBe('var(--color-success)');
		expect(labelOf(root).textContent).toBe('Valid JSON');
		expect(labelOf(root).style.color).toBe('var(--color-ink)');
	});

	it('uses the deep error tone for the label, which is the one that clears contrast', () => {
		const root = mount();
		createStatusBar(root).set('error', 'Unexpected token');
		expect(dotOf(root).style.backgroundColor).toBe('var(--color-error)');
		expect(labelOf(root).style.color).toBe('var(--color-error-deep)');
	});

	it('leaves the dot’s other classes alone', () => {
		// The class-swapping dialect this replaced rebuilt className from
		// scratch, silently dropping the sizing/shape utilities.
		const root = mount();
		createStatusBar(root).set('busy', 'Working');
		expect(dotOf(root).className).toBe('h-2 w-2 rounded-full bg-mute');
	});

	it('ignores a data-dot outside the live region', () => {
		// The graph viewer has a data-dot in its minimap SVG; an unscoped
		// lookup would paint that instead of the status dot.
		const root = mount({ decoyDot: true });
		createStatusBar(root).set('ok', 'Valid JSON');

		const decoy = root.querySelector<SVGElement>('svg [data-dot]')!;
		expect(decoy.getAttribute('style')).toBeNull();
		expect(dotOf(root).style.backgroundColor).toBe('var(--color-success)');
	});
});

describe('createStatusBar / flash', () => {
	it('shows the message, then reverts via refresh()', () => {
		const root = mount();
		const refresh = vi.fn(() => bar.set('ok', 'Valid JSON'));
		const bar = createStatusBar(root, { refresh });

		bar.flash('ok', 'Copied');
		expect(labelOf(root).textContent).toBe('Copied');

		vi.advanceTimersByTime(FLASH_MS - 1);
		expect(refresh).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(labelOf(root).textContent).toBe('Valid JSON');
	});

	it('a durable set() cancels a pending revert', () => {
		// Otherwise the stale refresh fires later and overwrites newer truth.
		const root = mount();
		const refresh = vi.fn();
		const bar = createStatusBar(root, { refresh });

		bar.flash('ok', 'Copied');
		bar.set('error', 'Unexpected token');

		vi.advanceTimersByTime(FLASH_MS * 2);
		expect(refresh).not.toHaveBeenCalled();
		expect(labelOf(root).textContent).toBe('Unexpected token');
	});

	it('a second flash restarts the window rather than stacking reverts', () => {
		const root = mount();
		const refresh = vi.fn();
		const bar = createStatusBar(root, { refresh });

		bar.flash('ok', 'First');
		vi.advanceTimersByTime(FLASH_MS - 10);
		bar.flash('ok', 'Second');

		vi.advanceTimersByTime(FLASH_MS - 10);
		expect(refresh).not.toHaveBeenCalled();

		vi.advanceTimersByTime(10);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('without a refresh, flash is just a set that never reverts', () => {
		const root = mount();
		createStatusBar(root).flash('ok', 'Copied');
		vi.advanceTimersByTime(FLASH_MS * 2);
		expect(labelOf(root).textContent).toBe('Copied');
	});

	it('destroy() cancels a pending revert', () => {
		const root = mount();
		const refresh = vi.fn();
		const bar = createStatusBar(root, { refresh });

		bar.flash('ok', 'Copied');
		bar.destroy();
		vi.advanceTimersByTime(FLASH_MS * 2);
		expect(refresh).not.toHaveBeenCalled();
	});
});

describe('createStatusBar / stats', () => {
	it('writes to the stats element when present', () => {
		const root = mount({ stats: true });
		createStatusBar(root).stats('1,240 rows');
		expect(root.querySelector('[data-stats]')!.textContent).toBe('1,240 rows');
	});

	it('is a silent no-op for islands with no stats element', () => {
		// Callers must never have to null-check; the guard dance was itself
		// part of the duplication this module removes.
		const root = mount({ stats: false });
		expect(() => createStatusBar(root).stats('ignored')).not.toThrow();
	});

	it('tolerates a root with no status bar at all', () => {
		const bare = document.createElement('div');
		const bar = createStatusBar(bare);
		expect(() => {
			bar.set('ok', 'Valid JSON');
			bar.flash('error', 'Nope');
			bar.stats('none');
		}).not.toThrow();
	});
});
