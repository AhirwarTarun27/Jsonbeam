/**
 * JSON → CSV / TSV engine — pure, dependency-free, fully typed.
 *
 * Lazy-loaded by the JsonConverter island on first conversion, so it never
 * touches a page's initial-JS budget. Everything runs in the browser.
 *
 * Design goals (to beat the field — miniwebtool, dataformatterpro, convertjsoncsv):
 *   • RFC 4180-correct quoting (quote only when a cell contains the delimiter,
 *     a quote, CR, or LF; escape embedded quotes by doubling).
 *   • Three deterministic strategies for nested structure rather than one:
 *       – flatten nested OBJECTS into dot-notation columns (a.b.c),
 *       – ARRAYS rendered as a joined cell, a compact-JSON cell, OR expanded
 *         into indexed columns (tags.0, tags.1, …).
 *   • Header is the UNION of every row's keys (first-seen order), so a ragged
 *     array of differently-shaped objects still produces a complete table.
 *   • Configurable delimiter (`,` `;` tab `|`), null rendering, and line ending.
 *   • Returns a structured preview (headers + raw cell grid) so the UI can render
 *     a real table, not just a wall of text.
 */

/** How array values are turned into CSV. */
export type CsvArrayMode = 'join' | 'json' | 'columns';

export interface CsvOptions {
	/** Field separator. Tab → TSV. */
	delimiter: ',' | ';' | '\t' | '|';
	/** Expand nested objects into dot-notation columns (`address.city`). */
	flatten: boolean;
	/** How arrays inside a row are rendered. */
	arrayMode: CsvArrayMode;
	/** Separator for `arrayMode: 'join'` on primitive arrays. */
	arraySeparator: string;
	/** Line ending between records. */
	newline: '\n' | '\r\n';
	/** Emit a header row of column names. */
	header: boolean;
	/** Text used for JSON `null` cells. */
	nullValue: string;
	/**
	 * Neutralize CSV-injection: prefix any cell that a spreadsheet would treat as
	 * a formula (starts with `= + - @`, tab, or CR) with a `'` so Excel/Sheets
	 * render it as text. Off by default — it mutates exported values — and skips
	 * plain numbers (so `-5` stays `-5`, while `=cmd` / `-1+2` get escaped).
	 */
	formulaGuard: boolean;
}

export interface CsvResult {
	/** The full CSV/TSV document (no BOM — the caller adds one for downloads). */
	csv: string;
	/** Column names, in output order. */
	headers: string[];
	/** Raw (un-escaped) cell grid aligned to `headers`, for a table preview. */
	rows: string[][];
	rowCount: number;
	columnCount: number;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
	delimiter: ',',
	flatten: true,
	arrayMode: 'join',
	arraySeparator: ', ',
	newline: '\n',
	header: true,
	nullValue: '',
	formulaGuard: false,
};

/** Characters that make a spreadsheet interpret a cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Prefix a formula-triggering cell with `'`, but leave plain numbers untouched. */
function guardFormula(cell: string): string {
	if (cell !== '' && FORMULA_LEAD.test(cell) && !Number.isFinite(Number(cell))) {
		return `'${cell}`;
	}
	return cell;
}

/** A single record collected as ordered field → cell-text pairs. */
type FlatRow = Map<string, string>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scalarToString(v: unknown, opts: CsvOptions): string {
	if (v === null || v === undefined) return opts.nullValue;
	if (typeof v === 'string') return v;
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	return String(v); // number
}

/** Walk one value into the flat row under `path`, honoring the structure options. */
function addField(path: string, value: unknown, opts: CsvOptions, out: FlatRow): void {
	if (Array.isArray(value)) {
		addArray(path, value, opts, out);
		return;
	}
	if (isPlainObject(value)) {
		const keys = Object.keys(value);
		if (!opts.flatten) {
			out.set(path, JSON.stringify(value));
			return;
		}
		// Flatten: recurse into each key. An empty object contributes no column.
		for (const k of keys) addField(`${path}.${k}`, value[k], opts, out);
		return;
	}
	out.set(path, scalarToString(value, opts));
}

function addArray(path: string, arr: unknown[], opts: CsvOptions, out: FlatRow): void {
	switch (opts.arrayMode) {
		case 'json':
			out.set(path, JSON.stringify(arr));
			return;
		case 'columns':
			arr.forEach((el, i) => addField(`${path}.${i}`, el, opts, out));
			return;
		case 'join': {
			const parts = arr.map((el) =>
				el !== null && typeof el === 'object' ? JSON.stringify(el) : scalarToString(el, opts),
			);
			out.set(path, parts.join(opts.arraySeparator));
			return;
		}
	}
}

/** Turn one top-level element into a flat row. Object keys are always columns;
 *  a non-object row goes under a single `value` column. */
function rowToFlat(element: unknown, opts: CsvOptions): FlatRow {
	const out: FlatRow = new Map();
	if (isPlainObject(element)) {
		for (const k of Object.keys(element)) addField(k, element[k], opts, out);
	} else {
		addField('value', element, opts, out);
	}
	return out;
}

/** RFC 4180: quote a cell only when it must be, doubling any embedded quotes. */
function escapeCell(cell: string, delimiter: string): string {
	if (
		cell.includes(delimiter) ||
		cell.includes('"') ||
		cell.includes('\n') ||
		cell.includes('\r')
	) {
		return `"${cell.replace(/"/g, '""')}"`;
	}
	return cell;
}

/** Normalize the parsed JSON into a list of row elements. */
function toRowElements(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [value];
}

/**
 * Convert a parsed JSON value into CSV/TSV. The input may be an array of objects
 * (the common case → one row each), a single object (→ one row), an array of
 * primitives (→ a single `value` column), or any other JSON value.
 */
export function jsonToCsv(value: unknown, options: Partial<CsvOptions> = {}): CsvResult {
	const opts: CsvOptions = { ...DEFAULT_CSV_OPTIONS, ...options };
	const elements = toRowElements(value);
	const flats = elements.map((el) => rowToFlat(el, opts));

	// Header = union of all keys, first-seen order preserved across every row.
	const headers: string[] = [];
	const seen = new Set<string>();
	for (const row of flats) {
		for (const key of row.keys()) {
			if (!seen.has(key)) {
				seen.add(key);
				headers.push(key);
			}
		}
	}

	const rows: string[][] = flats.map((row) => headers.map((h) => row.get(h) ?? ''));

	// The formula guard sanitizes only the emitted CSV text (what reaches a
	// spreadsheet) — the `rows` preview grid below stays faithful to the source.
	const cellOut = (c: string): string => escapeCell(opts.formulaGuard ? guardFormula(c) : c, opts.delimiter);
	const lines: string[] = [];
	if (opts.header) lines.push(headers.map(cellOut).join(opts.delimiter));
	for (const row of rows) {
		lines.push(row.map(cellOut).join(opts.delimiter));
	}

	return {
		csv: lines.join(opts.newline),
		headers,
		rows,
		rowCount: rows.length,
		columnCount: headers.length,
	};
}
