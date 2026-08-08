/**
 * Saving a generated file to disk.
 *
 * There were six copies of this across the islands with four different cleanup
 * strategies, and two of them were wrong in the same way:
 *
 *   URL.revokeObjectURL(a.href);   // immediately after a.click()
 *
 * Revoking synchronously races the browser's own read of the URL. Chrome
 * tolerates it; Firefox and Safari can hand the user a failed or empty
 * download. The correct shape — deferring the revoke, and parenting the anchor
 * before clicking it — existed in exactly one island. That one is promoted here
 * and is now the only implementation.
 *
 * Nothing in this module touches the network. The blob is built in the tab and
 * handed to the tab's own download machinery; the user's JSON never leaves the
 * page (CLAUDE.md contract 3).
 */

/**
 * How long the object URL stays alive after the click.
 *
 * The browser reads it asynchronously, so it must outlive the click by enough
 * for the download to be handed off. One second is the widely used figure and
 * costs nothing — the blob is released either way.
 */
const REVOKE_DELAY_MS = 1000;

/** Trigger a download of `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.rel = 'noopener';
	// Parented before clicking: a detached anchor's click is ignored in Firefox.
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Trigger a download of `text` as `filename`.
 *
 * `bom` prepends U+FEFF, which is what makes Excel detect UTF-8 in a CSV opened
 * by double-click instead of mangling non-ASCII. It is opt-in because the same
 * bytes confuse most non-Excel consumers.
 */
export function downloadText(text: string, filename: string, mime: string, bom = false): void {
	// Escaped, not the literal character: a bare U+FEFF is invisible in an
	// editor and survives a copy-paste into places it must not go.
	const body = bom ? `﻿${text}` : text;
	downloadBlob(new Blob([body], { type: mime }), filename);
}
