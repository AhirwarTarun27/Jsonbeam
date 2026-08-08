import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DEBOUNCE_MS, FLASH_MS, debounce } from '../src/lib/workbench/timing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('timing constants', () => {
	// These are the numbers the islands used to disagree about. Pinning them
	// means a future edit has to be deliberate rather than incidental.
	it('are the single source of truth for the workbench', () => {
		expect(DEBOUNCE_MS).toBe(300);
		expect(FLASH_MS).toBe(1400);
	});
});

describe('debounce', () => {
	it('collapses a burst into one trailing call', () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);

		d('a');
		d('b');
		d('c');
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		// Trailing edge: the newest arguments win, not the first.
		expect(fn).toHaveBeenCalledWith('c');
	});

	it('restarts the wait on each call rather than firing on a schedule', () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);

		d('x');
		vi.advanceTimersByTime(90);
		d('y');
		vi.advanceTimersByTime(90); // 180 ms total, but only 90 since the last call
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(10);
		expect(fn).toHaveBeenCalledExactlyOnceWith('y');
	});

	it('defaults to the shared DEBOUNCE_MS', () => {
		const fn = vi.fn();
		const d = debounce(fn);

		d();
		vi.advanceTimersByTime(DEBOUNCE_MS - 1);
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('flush() runs the pending call immediately', () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);

		d('now');
		d.flush();
		expect(fn).toHaveBeenCalledExactlyOnceWith('now');

		// The timer is consumed, so letting the clock run must not double-fire.
		vi.advanceTimersByTime(200);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('flush() with nothing pending does nothing', () => {
		const fn = vi.fn();
		debounce(fn, 100).flush();
		expect(fn).not.toHaveBeenCalled();
	});

	it('cancel() drops the pending call', () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);

		d('dropped');
		d.cancel();
		vi.advanceTimersByTime(500);
		expect(fn).not.toHaveBeenCalled();
	});

	it('is reusable after firing', () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);

		d('first');
		vi.advanceTimersByTime(100);
		d('second');
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith('second');
	});
});
