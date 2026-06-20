/**
 * Shared working document across the tool islands — the "paste once" carry.
 *
 * The document a user is working on is stashed here so that moving from one tool
 * page to another (via the switcher or the Next strip) rehydrates the same JSON
 * instead of forcing a re-paste. This is what turns separate SEO pages into one
 * seamless workbench.
 *
 * Privacy law (CLAUDE.md): this is `sessionStorage` ONLY — never the URL, never
 * the network. sessionStorage is per-tab and is cleared when the tab closes, so
 * the document never outlives the session and never leaves the browser.
 */

const KEY = 'jb-doc';

/**
 * sessionStorage quota is ~5 MB; stay well under it. Above this cap the carry is
 * skipped (the user re-pastes on the next page) rather than throwing — the tools
 * still process 100 MB inputs, those just don't ride along between pages.
 */
const MAX_CHARS = 1_000_000;

/** The carried document, or `null` if none was stored (or storage is blocked). */
export function loadDoc(): string | null {
	try {
		return sessionStorage.getItem(KEY);
	} catch {
		// Private mode / storage disabled — there is simply nothing to carry.
		return null;
	}
}

/**
 * Persist the current document for the next tool page. An empty string is stored
 * verbatim, so a deliberate Clear carries as "empty" rather than resurrecting the
 * previous document. Over-sized or storage-blocked writes are skipped silently —
 * and any stale entry is removed first, so a too-large doc can never rehydrate an
 * older, smaller one on the next page.
 */
export function saveDoc(value: string): void {
	try {
		if (value.length > MAX_CHARS) {
			sessionStorage.removeItem(KEY);
			return;
		}
		sessionStorage.setItem(KEY, value);
	} catch {
		// Storage blocked or quota exceeded — the carry is best-effort, never fatal.
	}
}
