/**
 * JSON → YAML emitter — pure, dependency-free, fully typed, YAML 1.2 block style.
 *
 * Lazy-loaded by the JsonConverter island, so it costs nothing until a YAML
 * conversion runs. Everything is local; nothing is uploaded.
 *
 * Why hand-rolled instead of js-yaml: full control over the option surface
 * (indent, sort, document marker, quoting policy), a tiny gzipped footprint, and
 * no third-party code to audit — while still being correct on the cases that
 * trip naive emitters:
 *   • Strings are quoted ONLY when a plain scalar would be misread (numbers,
 *     booleans, nulls, dates, indicator-leading text, `: ` / ` #` sequences,
 *     leading/trailing space) — otherwise emitted bare for readability.
 *   • Multiline strings become literal block scalars (`|-`) when clean, and fall
 *     back to double-quoted escapes when not (trailing spaces, tabs, controls).
 *   • Arrays of objects use the canonical dash-merged mapping layout.
 *   • Empty object / array render inline as `{}` / `[]` (block style can't).
 */

export type YamlQuoteStyle = 'auto' | 'single' | 'double';

export interface YamlOptions {
	/** Spaces per nesting level for mappings. */
	indent: number;
	/** Sort object keys alphabetically at every level. */
	sortKeys: boolean;
	/** Prepend the `---` document-start marker. */
	documentStart: boolean;
	/** `auto` quotes only when required; `single`/`double` force every string. */
	quoteStyle: YamlQuoteStyle;
}

export const DEFAULT_YAML_OPTIONS: YamlOptions = {
	indent: 2,
	sortKeys: false,
	documentStart: false,
	quoteStyle: 'auto',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEmptyContainer(v: unknown): boolean {
	if (Array.isArray(v)) return v.length === 0;
	if (isPlainObject(v)) return Object.keys(v).length === 0;
	return false;
}

/** A scalar (or empty container) that can sit on one line after a key/dash. */
function isInline(v: unknown): boolean {
	return v === null || typeof v !== 'object' || isEmptyContainer(v);
}

const pad = (n: number): string => ' '.repeat(n);

// ── String quoting ───────────────────────────────────────────────────────────

/** A C0 control char (U+0000–U+001F) or DEL (U+007F): can't live in a plain or
 *  single-quoted scalar, so its presence forces double-quoting. */
function isControlCode(code: number): boolean {
	return code < 0x20 || code === 0x7f;
}

function hasControlChar(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (isControlCode(s.charCodeAt(i))) return true;
	}
	return false;
}

/** True when a bare (plain) scalar would be re-parsed as something other than a
 *  string, or would break mapping/sequence/comment syntax. Conservative on
 *  purpose: over-quoting is safe, mis-parsing is not. */
function plainWouldMislead(s: string): boolean {
	if (s === '') return true;
	if (/^\s|\s$/.test(s)) return true; // leading / trailing whitespace
	// Booleans / nulls YAML 1.1-style loaders still accept.
	if (/^(null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/.test(s))
		return true;
	// Numbers: int, float, exponent, hex, octal, binary, .inf / .nan.
	if (/^[-+]?\.(inf|Inf|INF|nan|NaN|NAN)$/.test(s)) return true;
	if (/^[-+]?(0b[01_]+|0o[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?|\.[0-9_]+([eE][-+]?[0-9]+)?)$/.test(s))
		return true;
	// A leading indicator character changes the node's meaning.
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
	// `: ` (or trailing colon) reads as a mapping; ` #` starts a comment.
	if (/:(\s|$)/.test(s) || /\s#/.test(s)) return true;
	return false;
}

function doubleQuote(s: string): string {
	let out = '"';
	for (const ch of s) {
		const code = ch.codePointAt(0)!;
		if (ch === '"') out += '\\"';
		else if (ch === '\\') out += '\\\\';
		else if (ch === '\n') out += '\\n';
		else if (ch === '\t') out += '\\t';
		else if (ch === '\r') out += '\\r';
		else if (isControlCode(code)) out += '\\x' + code.toString(16).padStart(2, '0');
		else out += ch;
	}
	return out + '"';
}

function singleQuote(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}

function formatString(s: string, opts: YamlOptions): string {
	if (opts.quoteStyle === 'double') return doubleQuote(s);
	if (opts.quoteStyle === 'single') return hasControlChar(s) ? doubleQuote(s) : singleQuote(s);
	// auto
	if (hasControlChar(s)) return doubleQuote(s);
	if (plainWouldMislead(s)) return singleQuote(s);
	return s;
}

/** Single-line scalar text for a value known to be inline (`isInline`). */
function formatScalar(v: unknown, opts: YamlOptions): string {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
	if (Array.isArray(v)) return '[]'; // empty (isInline guaranteed)
	if (isPlainObject(v)) return '{}'; // empty
	return formatString(String(v), opts);
}

function formatKey(key: string, opts: YamlOptions): string {
	// Keys never use block scalars; a multiline key double-quotes onto one line.
	return formatString(key, opts);
}

// ── Multiline block scalars ──────────────────────────────────────────────────

/** Can this string be a clean `|-` literal block? Rejects anything that would
 *  need indentation/chomping indicators (leading/trailing space, tabs, CR,
 *  control chars, or a trailing newline). */
function canBlockScalar(s: string): boolean {
	if (!s.includes('\n')) return false;
	if (s.endsWith('\n')) return false;
	for (const line of s.split('\n')) {
		if (/[\t\r]/.test(line)) return false;
		if (/^\s/.test(line) || /\s$/.test(line)) return false;
		if (hasControlChar(line)) return false; // tab/CR already handled above
	}
	return true;
}

function isBlockString(v: unknown): v is string {
	return typeof v === 'string' && canBlockScalar(v);
}

/** Emit `<prefix> |-` then each content line at `contentIndent`. */
function pushBlockScalar(prefix: string, s: string, contentIndent: number, lines: string[]): void {
	lines.push(`${prefix} |-`);
	for (const line of s.split('\n')) lines.push(pad(contentIndent) + line);
}

// ── Block-style container emission ───────────────────────────────────────────

function entriesOf(obj: Record<string, unknown>, opts: YamlOptions): [string, unknown][] {
	const keys = Object.keys(obj);
	if (opts.sortKeys) keys.sort();
	return keys.map((k) => [k, obj[k]]);
}

/** Render a NON-EMPTY container's lines, each padded to `indent`. */
function emitContainer(value: unknown, indent: number, opts: YamlOptions, lines: string[]): void {
	if (isPlainObject(value)) {
		for (const [key, child] of entriesOf(value, opts)) {
			const prefix = pad(indent) + formatKey(key, opts) + ':';
			if (isBlockString(child)) {
				pushBlockScalar(prefix, child, indent + opts.indent, lines);
			} else if (isInline(child)) {
				lines.push(`${prefix} ${formatScalar(child, opts)}`);
			} else {
				lines.push(prefix);
				emitContainer(child, indent + opts.indent, opts, lines);
			}
		}
		return;
	}

	// Array. Sequence item content sits at indent + 2 (the width of "- ").
	const arr = value as unknown[];
	for (const item of arr) {
		const dash = pad(indent) + '-';
		if (isBlockString(item)) {
			pushBlockScalar(dash, item, indent + 2, lines);
		} else if (isInline(item)) {
			lines.push(`${dash} ${formatScalar(item, opts)}`);
		} else {
			const sub: string[] = [];
			emitContainer(item, indent + 2, opts, sub);
			// Merge the dash onto the item's first line (`-` + " " == 2 cols).
			lines.push(`${dash} ${sub[0].slice(indent + 2)}`);
			for (let i = 1; i < sub.length; i++) lines.push(sub[i]);
		}
	}
}

/**
 * Convert a parsed JSON value into a YAML 1.2 document (block style).
 */
export function jsonToYaml(value: unknown, options: Partial<YamlOptions> = {}): string {
	const opts: YamlOptions = { ...DEFAULT_YAML_OPTIONS, ...options };
	const lines: string[] = [];

	if (isBlockString(value)) {
		pushBlockScalar('', value, opts.indent, lines);
		// pushBlockScalar wrote " |-" with a leading space; trim it at root.
		lines[0] = lines[0].trimStart();
	} else if (isInline(value)) {
		lines.push(formatScalar(value, opts));
	} else {
		emitContainer(value, 0, opts, lines);
	}

	const body = lines.join('\n');
	return (opts.documentStart ? `---\n${body}` : body) + '\n';
}
