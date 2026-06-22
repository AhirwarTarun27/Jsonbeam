/**
 * Shared clipboard helper for the tool islands — part of the shared island core
 * (see also lib/island-theme).
 *
 * `navigator.clipboard.writeText` rejects (or `navigator.clipboard` is
 * `undefined`) in insecure contexts, sandboxed iframes, or when the user denies
 * the permission. Every island copied the same `try/await/catch` dance around
 * it — and two (query, converter) forgot the guard entirely, leaking an
 * unhandled rejection when the clipboard is blocked. One helper, one behavior:
 * callers branch on the returned boolean to show their own success / "Clipboard
 * unavailable" feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Blocked clipboard (insecure context / denied permission) — non-fatal.
		return false;
	}
}
