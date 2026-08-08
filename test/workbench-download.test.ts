// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, downloadText } from '../src/lib/workbench/download';

let created: string[];
let revoked: string[];
let clicked: HTMLAnchorElement[];

beforeEach(() => {
	vi.useFakeTimers();
	created = [];
	revoked = [];
	clicked = [];

	let n = 0;
	// jsdom implements neither of these.
	URL.createObjectURL = vi.fn(() => {
		const url = `blob:mock/${n++}`;
		created.push(url);
		return url;
	});
	URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));

	// Capture the click without letting jsdom attempt a navigation.
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		clicked.push(this);
		// Snapshot what the browser would see at click time.
		this.dataset.parentedAtClick = String(this.isConnected);
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('downloadBlob', () => {
	it('clicks an anchor carrying the object URL and filename', () => {
		downloadBlob(new Blob(['{}'], { type: 'application/json' }), 'data.json');

		expect(clicked).toHaveLength(1);
		expect(clicked[0].href).toBe(created[0]);
		expect(clicked[0].download).toBe('data.json');
	});

	it('parents the anchor before clicking', () => {
		// A detached anchor's click is ignored in Firefox — two of the copies
		// this replaces never appended, so their downloads were browser-dependent.
		downloadBlob(new Blob(['x']), 'a.txt');
		expect(clicked[0].dataset.parentedAtClick).toBe('true');
	});

	it('leaves no anchor behind in the document', () => {
		downloadBlob(new Blob(['x']), 'a.txt');
		expect(document.querySelectorAll('a')).toHaveLength(0);
	});

	it('defers the revoke instead of racing the download', () => {
		// The bug in the copies this replaces: revoking synchronously after
		// click can hand the user an empty file in Firefox and Safari.
		downloadBlob(new Blob(['x']), 'a.txt');
		expect(revoked).toEqual([]);

		vi.advanceTimersByTime(1000);
		expect(revoked).toEqual([created[0]]);
	});

	it('revokes every URL across repeated downloads', () => {
		downloadBlob(new Blob(['1']), 'one.txt');
		downloadBlob(new Blob(['2']), 'two.txt');

		vi.advanceTimersByTime(1000);
		expect(created).toHaveLength(2);
		expect(revoked.sort()).toEqual(created.sort());
	});
});

describe('downloadText', () => {
	it('sends the text through as a typed blob', async () => {
		downloadText('a,b\n1,2', 'data.csv', 'text/csv');

		const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
		expect(blob.type).toBe('text/csv');
		await expect(blob.text()).resolves.toBe('a,b\n1,2');
	});

	it('omits the BOM by default', async () => {
		downloadText('a,b', 'data.csv', 'text/csv');

		const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
		await expect(blob.text()).resolves.toBe('a,b');
	});

	it('prepends U+FEFF when asked, so Excel detects UTF-8', async () => {
		downloadText('náme', 'data.csv', 'text/csv', true);

		// Asserted on bytes, not text(): `Blob.text()` UTF-8-decodes, and that
		// step strips a leading BOM by spec — so it cannot see the thing under
		// test. The first three bytes are what Excel actually sniffs.
		const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
		const bytes = new Uint8Array(await blob.arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		await expect(blob.text()).resolves.toBe('náme');
	});
});
