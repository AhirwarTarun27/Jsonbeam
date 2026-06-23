/**
 * Lightweight JSON syntax highlighting for a plain <textarea> — the shared
 * "colour the input like the formatter" primitive for every framework-free
 * island (viewer, tree, table, graph, diff, query, converter).
 *
 * Why not CodeMirror? Those routes are held to a 40 KB gzip budget
 * (scripts/check-budget.mjs `LEAN`); CodeMirror only fits the 120 KB formatter
 * family. So instead of an editor engine we use the classic
 * transparent-textarea-over-a-highlighted-<pre> overlay:
 *
 *   • The user edits a normal <textarea> (full native editing/IME/undo), but its
 *     text is painted transparent — only the caret shows.
 *   • A <pre> mirror sits exactly behind it, rendering the same text tokenised
 *     into coloured <span>s, scroll-synced to the textarea.
 *
 * The textarea is switched to `wrap="off"` so it scrolls horizontally like a
 * code editor — this also makes the mirror alignment rock-solid (both panes use
 * `white-space: pre`). Tokenising runs on the RAW text (not via JSON.parse) so it
 * still colours mid-edit / invalid documents, and is throttled to one rAF per
 * burst. Above ~100 KB it bows out to a plain (but still legible) textarea, so a
 * huge paste never re-tokenises on every keystroke — mirrors the formatter's
 * own large-input valves. All styling lives in global.css (`.jb-hl*`).
 */

/** Above this many characters, skip the overlay (plain textarea) to stay fast. */
const MAX_HIGHLIGHT_CHARS = 100_000;

/** One regex pass: string | number | keyword | structural punctuation. */
const TOKEN =
	/("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:])/g;

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn raw JSON-ish text into highlighted HTML (escaped; safe to assign). */
function tokenize(src: string): string {
	let out = '';
	let last = 0;
	let m: RegExpExecArray | null;
	TOKEN.lastIndex = 0;
	while ((m = TOKEN.exec(src)) !== null) {
		if (m.index > last) out += escapeHtml(src.slice(last, m.index));
		const tok = m[0];
		const ch = tok[0]!;
		let cls: string;
		if (ch === '"') {
			// A string is a key when the next non-whitespace char is ':'. (For broken
			// mid-edit text this is a heuristic, which is fine — it just picks a colour.)
			let j = TOKEN.lastIndex;
			while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++;
			cls = src[j] === ':' ? 'jb-hl-key' : 'jb-hl-str';
		} else if (ch === '-' || (ch >= '0' && ch <= '9')) {
			cls = 'jb-hl-num';
		} else if (ch === 't' || ch === 'f' || ch === 'n') {
			cls = 'jb-hl-kw';
		} else {
			cls = 'jb-hl-punct';
		}
		out += `<span class="${cls}">${escapeHtml(tok)}</span>`;
		last = TOKEN.lastIndex;
	}
	if (last < src.length) out += escapeHtml(src.slice(last));
	return out;
}

export interface HighlightHandle {
	/** Re-tokenise from the textarea's current value (call after setting it programmatically). */
	refresh(): void;
	/** Detach listeners (rarely needed — islands live for the page's lifetime). */
	destroy(): void;
}

/**
 * Wrap `textarea` in the highlight overlay and keep its mirror in sync. Safe to
 * call once per textarea; returns a handle whose `refresh()` islands invoke after
 * any programmatic `value` change (Sample / Clear / doc-store carry / init).
 */
export function attachHighlight(textarea: HTMLTextAreaElement): HighlightHandle {
	const parent = textarea.parentNode;
	const wrap = document.createElement('div');
	wrap.className = 'jb-hl';
	const mirror = document.createElement('pre');
	mirror.className = 'jb-hl-mirror';
	mirror.setAttribute('aria-hidden', 'true');

	if (parent) {
		parent.insertBefore(wrap, textarea);
		wrap.append(mirror, textarea);
	}
	textarea.classList.add('jb-hl-input');
	// No soft-wrap → horizontal scroll like a code editor, and exact mirror alignment.
	textarea.setAttribute('wrap', 'off');

	let raf = 0;
	let plain = false;

	function syncScroll(): void {
		mirror.scrollTop = textarea.scrollTop;
		mirror.scrollLeft = textarea.scrollLeft;
	}

	function render(): void {
		const val = textarea.value;
		if (val.length > MAX_HIGHLIGHT_CHARS) {
			// Large input: drop the mirror, let the textarea show plain legible text.
			if (!plain) {
				plain = true;
				wrap.classList.add('jb-hl--plain');
				mirror.textContent = '';
			}
			return;
		}
		if (plain) {
			plain = false;
			wrap.classList.remove('jb-hl--plain');
		}
		// A trailing space guards the final empty line so its height matches the
		// textarea's (browsers don't render a pre's last bare newline).
		mirror.innerHTML = tokenize(val) + (val === '' || val.endsWith('\n') ? ' ' : '');
		syncScroll();
	}

	function onInput(): void {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			render();
		});
	}

	textarea.addEventListener('input', onInput);
	textarea.addEventListener('scroll', syncScroll, { passive: true });

	render();

	return {
		refresh: render,
		destroy() {
			textarea.removeEventListener('input', onInput);
			textarea.removeEventListener('scroll', syncScroll);
			if (raf) cancelAnimationFrame(raf);
		},
	};
}
