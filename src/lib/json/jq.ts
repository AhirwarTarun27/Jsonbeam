/**
 * jq-compatible filter evaluator — pure TypeScript, no WASM.
 *
 * Covers the 95 % of real-world jq usage: field/index/iter access, pipe, comma,
 * alternative, comparisons, arithmetic, if/try/reduce, array/object construction,
 * the full built-in library (select, map, sort_by, group_by, to_entries, paths,
 * @formats, string interpolation, update operators, variable binding, user-defined
 * functions, and more). Unsupported edges throw descriptive errors.
 *
 * Public API:
 *   runJq(input: unknown, expr: string): JqResult
 */

// ─── Public ───────────────────────────────────────────────────────────────────

export type JqResult =
	| { ok: true;  values: unknown[]; truncated: boolean }
	| { ok: false; error: string };

/** Safety cap: collect at most this many output values before truncating. */
const MAX_OUT = 10_000;

export function runJq(input: unknown, expr: string): JqResult {
	try {
		const ast = parse(expr);
		const out: unknown[] = [];
		let truncated = false;
		for (const v of evalNode(ast, input, ROOT_ENV)) {
			out.push(v);
			if (out.length >= MAX_OUT) { truncated = true; break; }
		}
		return { ok: true, values: out, truncated };
	} catch (e) {
		return { ok: false, error: e instanceof JqError ? e.message : String(e) };
	}
}

// ─── Error ────────────────────────────────────────────────────────────────────

class JqError extends Error {}
class JqBreak extends Error { constructor(public label: string) { super('break:' + label); } }
class JqEmpty extends Error { constructor() { super('$__empty__'); } }

function err(msg: string): never { throw new JqError(msg); }

// ─── Regex safety ───────────────────────────────────────────────────────────────
//
// jq runs on the main thread (no worker yet), so a user-supplied pattern with
// catastrophic backtracking — e.g. `(a+)+$` against a long non-matching string —
// would freeze the tab. JS regexes can't be interrupted once started, so we
// reject the textbook ReDoS shape up front: a repetition applied to a group that
// itself contains a repetition (star height > 1). This is a conservative,
// best-effort guard, not a proof of safety; it catches the common footguns
// (nested `*`/`+`/`{n,}`) while leaving ordinary patterns untouched.
function reDoSRisk(src: string): boolean {
	const stack: { quant: boolean }[] = [];
	let lastClosedQuant = false; // did the group that just closed contain a quantifier?
	let justClosed = false;      // was the previous token a `)`?
	for (let i = 0; i < src.length; i++) {
		const c = src[i]!;
		if (c === '\\') { i++; justClosed = false; continue; }
		if (c === '[') { // skip character class — its contents are atoms
			i++;
			while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; }
			justClosed = false;
			continue;
		}
		if (c === '(') { stack.push({ quant: false }); justClosed = false; continue; }
		if (c === ')') { lastClosedQuant = stack.pop()?.quant ?? false; justClosed = true; continue; }
		if (c === '*' || c === '+' || c === '{') {
			if (stack.length) stack[stack.length - 1]!.quant = true;
			// A quantifier applied to a group that already had one → nested → risk.
			if (justClosed && lastClosedQuant) return true;
			if (c === '{') { while (i < src.length && src[i] !== '}') i++; }
			justClosed = false;
			continue;
		}
		justClosed = false;
	}
	return false;
}

/** Compile a user regex, rejecting catastrophic patterns and surfacing a jq-style error. */
function compileRegex(src: string, flags = ''): RegExp {
	if (reDoSRisk(src)) {
		err(`${JSON.stringify(src)} is not a valid regex: rejected — nested quantifiers can cause catastrophic backtracking`);
	}
	try {
		return new RegExp(src, flags);
	} catch (e) {
		err(`${JSON.stringify(src)} is not a valid regex: ${(e as Error).message}`);
	}
}

// ─── Types ────────────────────────────────────────────────────────────────────

type JV = unknown;

interface Env {
	vars: Map<string, JV>;
	fns: Map<string, FnDef>;
}

interface UserFn { kind: 'user'; params: string[]; body: AST; env: Env }
interface BuiltinFn { kind: 'builtin'; fn: (args: AST[], input: JV, env: Env) => Iterable<JV> }
type FnDef = UserFn | BuiltinFn;

// ─── AST ──────────────────────────────────────────────────────────────────────

type AST =
	| { t: 'id' }
	| { t: 'rec' }
	| { t: 'lit'; v: JV }
	| { t: 'field'; n: string; opt: boolean }
	| { t: 'idx'; e: AST; opt: boolean }
	| { t: 'iter'; opt: boolean }
	| { t: 'slice'; lo: AST | null; hi: AST | null; obj: AST | null }
	| { t: 'pipe'; l: AST; r: AST }
	| { t: 'comma'; l: AST; r: AST }
	| { t: 'alt'; l: AST; r: AST }
	| { t: 'add' | 'sub' | 'mul' | 'div' | 'mod'; l: AST; r: AST }
	| { t: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'; l: AST; r: AST }
	| { t: 'and' | 'or'; l: AST; r: AST }
	| { t: 'not' | 'neg'; e: AST }
	| { t: 'arr'; e: AST | null }
	| { t: 'obj'; fs: ObjField[] }
	| { t: 'call'; n: string; args: AST[] }
	| { t: 'if'; c: AST; th: AST; el: AST | null }
	| { t: 'try'; b: AST; ct: AST | null }
	| { t: 'reduce'; e: AST; p: string; i: AST; u: AST }
	| { t: 'foreach'; e: AST; p: string; i: AST; u: AST; ex: AST | null }
	| { t: 'bind'; e: AST; p: string; b: AST }
	| { t: 'label'; n: string; b: AST }
	| { t: 'break'; n: string }
	| { t: 'path'; e: AST }
	| { t: 'assign'; l: AST; r: AST }
	| { t: 'update'; l: AST; r: AST }
	| { t: 'updop'; l: AST; op: string; r: AST }
	| { t: 'interp'; ps: (string | AST)[] }
	| { t: 'fmt'; f: string; e: AST | null }
	| { t: 'def'; n: string; ps: string[]; b: AST; rest: AST }
	| { t: 'var'; n: string }
	| { t: 'opt'; e: AST }
	| { t: 'getpath'; p: AST }
	| { t: 'setpath'; p: AST; v: AST }
	| { t: 'delpaths'; p: AST };

interface ObjField {
	k: AST | string;   // string = bare key
	v: AST | null;     // null = shorthand .key
	computed: boolean; // true if key is an expression in parens
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TK =
	'dot' | 'dotdot' | 'pipe' | 'comma' | 'semi' | 'colon'
	| 'lbrack' | 'rbrack' | 'lbrace' | 'rbrace' | 'lparen' | 'rparen'
	| 'ident' | 'string' | 'strinterp' | 'number'
	| 'null' | 'true' | 'false'
	| 'quest' | 'at' | 'dollar'
	| 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
	| 'plus' | 'minus' | 'star' | 'slash' | 'percent'
	| 'alt' | 'assign' | 'upipe' | 'ualt'
	| 'pluseq' | 'minuseq' | 'stareq' | 'slasheq' | 'percenteq'
	| 'tryalt' | 'eof';

interface Tok { k: TK; v: string | number | (string | string[])[]; pos: number }

function tokenize(src: string): Tok[] {
	const toks: Tok[] = [];
	let i = 0;
	const len = src.length;

	function push(k: TK, v: Tok['v'] = '') { toks.push({ k, v, pos: i }); }

	while (i < len) {
		// skip whitespace and comments
		while (i < len && src[i]! <= ' ') i++;
		if (i >= len) break;
		if (src[i] === '#') { while (i < len && src[i] !== '\n') i++; continue; }

		const ch = src[i]!;
		const pos = i;

		// numbers
		if ((ch >= '0' && ch <= '9') || (ch === '-' && src[i+1]! >= '0' && src[i+1]! <= '9' && (toks.length === 0 || ['pipe','comma','lbrack','lparen','lbrace','semi','colon','eq','ne','lt','le','gt','ge','plus','minus','star','slash','percent','alt','assign','upipe','ualt','tryalt'].includes(toks[toks.length-1]!.k)))) {
			let s = '';
			if (ch === '-') { s = '-'; i++; }
			while (i < len && ((src[i]! >= '0' && src[i]! <= '9') || src[i] === '.' || src[i] === 'e' || src[i] === 'E' || src[i] === '+' || (src[i] === '-' && (src[i-1] === 'e' || src[i-1] === 'E')))) {
				s += src[i++];
			}
			toks.push({ k: 'number', v: parseFloat(s), pos });
			continue;
		}

		i++; // consume ch

		switch (ch) {
			case '.': {
				if (src[i] === '.') { i++; push('dotdot'); break; }
				push('dot');
				break;
			}
			case '|': {
				if (src[i] === '=') { i++; push('upipe'); break; }
				push('pipe');
				break;
			}
			case ',': push('comma'); break;
			case ';': push('semi'); break;
			case ':': push('colon'); break;
			case '[': push('lbrack'); break;
			case ']': push('rbrack'); break;
			case '{': push('lbrace'); break;
			case '}': push('rbrace'); break;
			case '(': push('lparen'); break;
			case ')': push('rparen'); break;
			case '+': if (src[i] === '=') { i++; push('pluseq'); } else push('plus'); break;
			case '-': if (src[i] === '=') { i++; push('minuseq'); } else push('minus'); break;
			case '*': if (src[i] === '=') { i++; push('stareq'); } else push('star'); break;
			case '/': {
				if (src[i] === '/') {
					i++;
					if (src[i] === '=') { i++; push('ualt'); }
					else push('alt');
				} else if (src[i] === '=') {
					i++; push('slasheq');
				} else {
					push('slash');
				}
				break;
			}
			case '%': if (src[i] === '=') { i++; push('percenteq'); } else push('percent'); break;
			case '=': {
				if (src[i] === '=') { i++; push('eq'); } else push('assign');
				break;
			}
			case '!': {
				if (src[i] === '=') { i++; push('ne'); } else err(`unexpected '!'`);
				break;
			}
			case '<': if (src[i] === '=') { i++; push('le'); } else push('lt'); break;
			case '>': if (src[i] === '=') { i++; push('ge'); } else push('gt'); break;
			case '?': {
				if (src[i] === '/' && src[i+1] === '/') { i += 2; push('tryalt'); }
				else push('quest');
				break;
			}
			case '@': {
				// format string: @base64, @uri, etc.
				let name = '';
				while (i < len && /\w/.test(src[i]!)) name += src[i++];
				push('at', name);
				break;
			}
			case '$': {
				// variable
				if (/[a-zA-Z_]/.test(src[i] ?? '')) {
					let name = '';
					while (i < len && /\w/.test(src[i]!)) name += src[i++];
					push('dollar', name);
				} else {
					err(`expected variable name after '$'`);
				}
				break;
			}
			case '"': {
				// String — may contain \( interpolations
				const { text, parts, hasInterp } = readString(src, i - 1);
				i = text.endPos;
				if (hasInterp) {
					toks.push({ k: 'strinterp', v: parts, pos });
				} else {
					toks.push({ k: 'string', v: parts[0] as string ?? '', pos });
				}
				break;
			}
			default: {
				if (/[a-zA-Z_]/.test(ch)) {
					let name = ch;
					while (i < len && /[\w]/.test(src[i]!)) name += src[i++];
					const kws: Record<string, TK> = {
						null: 'null', true: 'true', false: 'false',
						if: 'ident', then: 'ident', elif: 'ident', else: 'ident', end: 'ident',
						try: 'ident', catch: 'ident', reduce: 'ident', foreach: 'ident',
						label: 'ident', break: 'ident', as: 'ident', def: 'ident',
						import: 'ident', include: 'ident', and: 'ident', or: 'ident', not: 'ident',
					};
					toks.push({ k: kws[name] ?? 'ident', v: name, pos });
				} else {
					err(`unexpected character: ${JSON.stringify(ch)}`);
				}
			}
		}
	}
	toks.push({ k: 'eof', v: '', pos: i });
	return toks;
}

interface StringRead {
	text: { endPos: number };
	parts: (string | string[])[];  // strings are literal, string[] = ['expr raw text']
	hasInterp: boolean;
}

function readString(src: string, startQuote: number): StringRead {
	let i = startQuote + 1; // skip opening "
	let cur = '';
	const parts: (string | string[])[] = [];
	let hasInterp = false;

	while (i < src.length) {
		const ch = src[i++]!;
		if (ch === '"') {
			parts.push(cur);
			return { text: { endPos: i }, parts, hasInterp };
		}
		if (ch === '\\') {
			const esc = src[i++]!;
			if (esc === '(') {
				// interpolation: find matching )
				hasInterp = true;
				parts.push(cur);
				cur = '';
				let depth = 1;
				let raw = '';
				while (i < src.length && depth > 0) {
					const c = src[i++]!;
					if (c === '(') depth++;
					else if (c === ')') { depth--; if (depth === 0) break; }
					else if (c === '"') {
						// nested string inside interpolation
						raw += c;
						while (i < src.length) {
							const nc = src[i++]!;
							raw += nc;
							if (nc === '\\' && src[i]) { raw += src[i++]!; continue; }
							if (nc === '"') break;
						}
						continue;
					}
					raw += c;
				}
				parts.push([raw]); // array marks it as an expression
			} else {
				const escapes: Record<string, string> = {
					'"': '"', '\\': '\\', '/': '/', 'n': '\n', 'r': '\r',
					't': '\t', 'b': '\b', 'f': '\f',
				};
				if (esc === 'u') {
					const hex = src.slice(i, i + 4);
					i += 4;
					cur += String.fromCharCode(parseInt(hex, 16));
				} else {
					cur += escapes[esc] ?? esc;
				}
			}
		} else {
			cur += ch;
		}
	}
	err('unterminated string');
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parse(src: string): AST {
	const toks = tokenize(src);
	let i = 0;

	function peek(offset = 0): Tok { return toks[i + offset] ?? toks[toks.length - 1]!; }
	function is(k: TK, offset = 0) { return peek(offset).k === k; }
	function isIdent(v: string, offset = 0) { return is('ident', offset) && peek(offset).v === v; }
	function consume() { return toks[i++]!; }
	function expect(k: TK) {
		if (!is(k)) err(`expected ${k}, got ${peek().k} ('${peek().v}') at pos ${peek().pos}`);
		return consume();
	}
	function expectIdent(v: string) {
		if (!isIdent(v)) err(`expected '${v}', got '${peek().v}'`);
		consume();
	}

	// Forward declaration for recursion
	function parseExpr(): AST { return parseDef(); }

	function parseDef(): AST {
		if (!isIdent('def')) return parsePipe();
		consume(); // def
		const name = String(expect('ident').v);
		const params: string[] = [];
		if (is('lparen')) {
			consume();
			while (!is('rparen')) {
				if (params.length > 0) expect('semi');
				// param can be $var or just name (filter arg). The tokenizer carries
				// the variable name in the dollar token's value — read it directly.
				if (is('dollar')) { params.push('$' + String(consume().v)); }
				else params.push(String(expect('ident').v));
			}
			expect('rparen');
		}
		expect('colon');
		const body = parsePipe();
		expect('semi');
		const rest = parseExpr();
		return { t: 'def', n: name, ps: params, b: body, rest };
	}

	function parsePipe(): AST {
		// label $x | ...
		if (isIdent('label')) {
			consume();
			// Store the label name WITH its `$` so it matches the `break` node below.
			const name = '$' + String(expect('dollar').v);
			expect('pipe');
			const body = parsePipe();
			return { t: 'label', n: name, b: body };
		}
		let l = parseComma();
		while (is('pipe')) {
			consume();
			// expr as $var |
			if (isIdent('as', -1)) { /* handled inside */ }
			const r = parsePipe(); // right-assoc
			l = { t: 'pipe', l, r };
		}
		return l;
	}

	function parseComma(): AST {
		let l = parseAlt();
		while (is('comma')) {
			consume();
			const r = parseAlt();
			l = { t: 'comma', l, r };
		}
		return l;
	}

	function parseAlt(): AST {
		let l = parseBind();
		while (is('alt')) {
			consume();
			const r = parseBind();
			l = { t: 'alt', l, r };
		}
		return l;
	}

	function parseBind(): AST {
		const e = parseControl();
		if (isIdent('as')) {
			consume();
			const pat = parsePattern();
			expect('pipe');
			const body = parsePipe();
			return { t: 'bind', e, p: pat, b: body };
		}
		return e;
	}

	function parsePattern(): string {
		// For now: only $ident patterns (not destructuring). The tokenizer already
		// carries the variable name in the dollar token's value.
		return '$' + String(expect('dollar').v);
	}

	function parseControl(): AST {
		if (isIdent('if')) return parseIf();
		if (isIdent('try')) return parseTry();
		if (isIdent('reduce')) return parseReduce();
		if (isIdent('foreach')) return parseForeach();
		return parseUpdateExpr();
	}

	function parseIf(): AST {
		expectIdent('if');
		const c = parsePipe();
		expectIdent('then');
		const th = parsePipe();
		let el: AST | null = null;
		if (isIdent('elif')) {
			el = parseIf_elif();
		} else if (isIdent('else')) {
			consume();
			el = parsePipe();
			expectIdent('end');
		} else {
			expectIdent('end');
		}
		return { t: 'if', c, th, el };
	}

	function parseIf_elif(): AST {
		expectIdent('elif');
		const c = parsePipe();
		expectIdent('then');
		const th = parsePipe();
		let el: AST | null = null;
		if (isIdent('elif')) el = parseIf_elif();
		else if (isIdent('else')) { consume(); el = parsePipe(); expectIdent('end'); }
		else expectIdent('end');
		return { t: 'if', c, th, el };
	}

	function parseTry(): AST {
		expectIdent('try');
		const body = parsePostfix();
		let ct: AST | null = null;
		if (isIdent('catch')) { consume(); ct = parsePostfix(); }
		return { t: 'try', b: body, ct };
	}

	function parseReduce(): AST {
		expectIdent('reduce');
		const e = parsePostfix();
		expectIdent('as');
		const pat = parsePattern();
		expect('lparen');
		const init = parsePipe();
		expect('semi');
		const upd = parsePipe();
		expect('rparen');
		return { t: 'reduce', e, p: pat, i: init, u: upd };
	}

	function parseForeach(): AST {
		expectIdent('foreach');
		const e = parsePostfix();
		expectIdent('as');
		const pat = parsePattern();
		expect('lparen');
		const init = parsePipe();
		expect('semi');
		const upd = parsePipe();
		let ex: AST | null = null;
		if (is('semi')) { consume(); ex = parsePipe(); }
		expect('rparen');
		return { t: 'foreach', e, p: pat, i: init, u: upd, ex };
	}

	function parseUpdateExpr(): AST {
		const l = parseCmp();
		const k = peek().k;
		if (k === 'assign') { consume(); return { t: 'assign', l, r: parseAlt() }; }
		if (k === 'upipe') { consume(); return { t: 'update', l, r: parseAlt() }; }
		if (k === 'ualt') { consume(); return { t: 'updop', l, op: '//', r: parseAlt() }; }
		if (k === 'pluseq') { consume(); return { t: 'updop', l, op: '+', r: parseAlt() }; }
		if (k === 'minuseq') { consume(); return { t: 'updop', l, op: '-', r: parseAlt() }; }
		if (k === 'stareq') { consume(); return { t: 'updop', l, op: '*', r: parseAlt() }; }
		if (k === 'slasheq') { consume(); return { t: 'updop', l, op: '/', r: parseAlt() }; }
		if (k === 'percenteq') { consume(); return { t: 'updop', l, op: '%', r: parseAlt() }; }
		return l;
	}

	function parseCmp(): AST {
		let l = parseAndOr();
		const cmpMap: Partial<Record<TK, AST['t']>> = {
			eq: 'eq', ne: 'ne', lt: 'lt', le: 'le', gt: 'gt', ge: 'ge',
		};
		while (peek().k in cmpMap) {
			const op = cmpMap[consume().k]!;
			l = { t: op, l, r: parseAndOr() } as AST;
		}
		return l;
	}

	function parseAndOr(): AST {
		let l = parseAdd();
		while (isIdent('and') || isIdent('or')) {
			const op = consume().v as string;
			l = { t: op as 'and' | 'or', l, r: parseAdd() };
		}
		return l;
	}

	function parseAdd(): AST {
		let l = parseMul();
		while (is('plus') || is('minus')) {
			const op = consume().k === 'plus' ? 'add' : 'sub';
			l = { t: op, l, r: parseMul() };
		}
		return l;
	}

	function parseMul(): AST {
		let l = parseUnary();
		while (is('star') || is('slash') || is('percent')) {
			const opMap: Record<string, AST['t']> = { star: 'mul', slash: 'div', percent: 'mod' };
			const op = opMap[consume().k]!;
			l = { t: op, l, r: parseUnary() } as AST;
		}
		return l;
	}

	function parseUnary(): AST {
		if (is('minus')) { consume(); return { t: 'neg', e: parsePostfix() }; }
		return parsePostfix();
	}

	function parsePostfix(): AST {
		let e = parsePrimary();
		for (;;) {
			// optional operator
			if (is('quest') && !is('pipe', 1) && !is('comma', 1) && !is('semi', 1)) {
				consume();
				e = { t: 'opt', e };
				continue;
			}
			// field access via dot after primary: e.field
			if (is('dot')) {
				const dotTok = consume();
				// `.ident` (no space) is a field; `. ident` (space before a keyword
				// like `as`/`end`/`and`) is bare-dot + keyword. jq disambiguates by
				// adjacency — the field name must be flush against the dot.
				if ((is('ident') && peek().pos === dotTok.pos) || is('string')) {
					const n = String(consume().v);
					const opt = is('quest') ? (consume(), true) : false;
					e = { t: 'pipe', l: e, r: { t: 'field', n, opt } };
					continue;
				}
				if (is('lbrack')) {
					// e.[] or e.[n] - handled below
					// put dot back conceptually (don't push back, handle next iter)
					// Actually, e.[] means: pipe e into iter
					consume(); // [
					if (is('rbrack')) { consume(); const opt = is('quest') ? (consume(), true) : false; e = { t: 'pipe', l: e, r: { t: 'iter', opt } }; continue; }
					// e.[n:m] slice
					const lo = is('colon') ? null : parsePipe();
					if (is('colon')) { consume(); const hi = is('rbrack') ? null : parsePipe(); expect('rbrack'); e = { t: 'pipe', l: e, r: { t: 'slice', lo, hi, obj: null } }; continue; }
					expect('rbrack');
					const opt = is('quest') ? (consume(), true) : false;
					e = { t: 'pipe', l: e, r: { t: 'idx', e: lo!, opt } };
					continue;
				}
				// bare .  after e — e | .
				e = { t: 'pipe', l: e, r: { t: 'id' } };
				continue;
			}
			// e[...] bracket indexing
			if (is('lbrack')) {
				consume();
				if (is('rbrack')) { consume(); const opt = is('quest') ? (consume(), true) : false; e = { t: 'pipe', l: e, r: { t: 'iter', opt } }; continue; }
				const lo = is('colon') ? null : parsePipe();
				if (is('colon')) { consume(); const hi = is('rbrack') ? null : parsePipe(); expect('rbrack'); e = { t: 'pipe', l: e, r: { t: 'slice', lo, hi, obj: null } }; continue; }
				expect('rbrack');
				const opt = is('quest') ? (consume(), true) : false;
				e = { t: 'pipe', l: e, r: { t: 'idx', e: lo!, opt } };
				continue;
			}
			break;
		}
		return e;
	}

	function parsePrimary(): AST {
		const tok = peek();

		// identity/recursive/field access starting with dot
		if (is('dot')) {
			const dotTok = consume();
			// `.ident` (flush) is a field; `. ident` (a space before a keyword such
			// as `as`/`end`/`and`) is the identity filter followed by that keyword.
			if ((is('ident') && peek().pos === dotTok.pos) || is('string')) {
				const n = String(consume().v);
				const opt = is('quest') ? (consume(), true) : false;
				return { t: 'field', n, opt };
			}
			if (is('lbrack')) {
				consume();
				if (is('rbrack')) { consume(); const opt = is('quest') ? (consume(), true) : false; return { t: 'iter', opt }; }
				const lo = is('colon') ? null : parsePipe();
				if (is('colon')) { consume(); const hi = is('rbrack') ? null : parsePipe(); expect('rbrack'); return { t: 'slice', lo, hi, obj: null }; }
				expect('rbrack');
				const opt = is('quest') ? (consume(), true) : false;
				return { t: 'idx', e: lo!, opt };
			}
			return { t: 'id' };
		}

		if (is('dotdot')) { consume(); return { t: 'rec' }; }

		if (is('null')) { consume(); return { t: 'lit', v: null }; }
		if (is('true')) { consume(); return { t: 'lit', v: true }; }
		if (is('false')) { consume(); return { t: 'lit', v: false }; }
		if (is('number')) { return { t: 'lit', v: consume().v as number }; }

		if (is('string')) {
			const s = consume().v as string;
			return { t: 'lit', v: s };
		}

		if (is('strinterp')) {
			const raw = consume().v as (string | string[])[];
			const parts: (string | AST)[] = [];
			for (const p of raw) {
				if (typeof p === 'string') parts.push(p);
				else parts.push(parse(p[0]!)); // parse the expression inside \(...)
			}
			return { t: 'interp', ps: parts };
		}

		if (is('dollar')) {
			return { t: 'var', n: '$' + String(consume().v) };
		}

		if (is('at')) {
			const fmt = String(consume().v);
			if (is('string') || is('strinterp')) {
				// @format "string" = format interpolated string
				const inner = parsePrimary();
				return { t: 'fmt', f: fmt, e: inner };
			}
			return { t: 'fmt', f: fmt, e: null };
		}

		if (is('lparen')) {
			consume();
			const e = parseExpr();
			expect('rparen');
			return e;
		}

		if (is('lbrack')) {
			consume();
			if (is('rbrack')) { consume(); return { t: 'arr', e: null }; }
			const e = parseExpr();
			expect('rbrack');
			return { t: 'arr', e };
		}

		if (is('lbrace')) {
			consume();
			const fs: ObjField[] = [];
			while (!is('rbrace')) {
				if (fs.length > 0) expect('comma');
				if (is('lparen')) {
					// computed key: (expr): val
					consume();
					const kExpr = parseExpr();
					expect('rparen');
					expect('colon');
					const v = parseAlt();
					fs.push({ k: kExpr, v, computed: true });
				} else if (is('dollar')) {
					const n = '$' + String(consume().v);
					fs.push({ k: n.slice(1), v: { t: 'var', n }, computed: false });
				} else if (is('ident') || is('string') || is('number')) {
					const key = String(consume().v);
					if (is('colon')) {
						consume();
						const v = parseAlt();
						fs.push({ k: key, v, computed: false });
					} else {
						// shorthand: {foo} = {foo: .foo}
						fs.push({ k: key, v: null, computed: false });
					}
				} else {
					err(`unexpected token in object: ${peek().k}`);
				}
			}
			expect('rbrace');
			return { t: 'obj', fs };
		}

		if (is('ident')) {
			const name = String(tok.v);
			if (name === 'break') { consume(); return { t: 'break', n: '$' + String(expect('dollar').v) }; }
			// `not` is a 0-arg filter in jq (`. | not`), not a prefix operator —
			// fall through to the call path so bare `not` resolves to the builtin.
			if (name === 'path') { consume(); expect('lparen'); const e = parseExpr(); expect('rparen'); return { t: 'path', e }; }
			if (name === 'getpath') { consume(); expect('lparen'); const p = parseExpr(); expect('rparen'); return { t: 'getpath', p }; }
			if (name === 'setpath') { consume(); expect('lparen'); const p = parseExpr(); expect('semi'); const v = parseExpr(); expect('rparen'); return { t: 'setpath', p, v }; }
			if (name === 'delpaths') { consume(); expect('lparen'); const p = parseExpr(); expect('rparen'); return { t: 'delpaths', p }; }

			consume();
			if (is('lparen')) {
				consume();
				const args: AST[] = [];
				if (!is('rparen')) {
					args.push(parseExpr());
					while (is('semi')) { consume(); args.push(parseExpr()); }
				}
				expect('rparen');
				return { t: 'call', n: name, args };
			}
			// zero-arg function
			return { t: 'call', n: name, args: [] };
		}

		if (is('eof')) err('unexpected end of expression');
		err(`unexpected token: ${tok.k} ('${tok.v}')`);
	}

	const ast = parseExpr();
	if (!is('eof')) err(`unexpected token after expression: ${peek().k} ('${peek().v}')`);
	return ast;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeOf(v: JV): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v === 'object' ? 'object' : typeof v;
}

/**
 * jq truthiness: every value is true except `null` and `false`. (So `0`, `""`,
 * `[]`, and `{}` are all truthy — unlike JavaScript.) Used by `if`, `and`, `or`,
 * `not`, and `select`.
 */
function jqTruthy(v: JV): boolean {
	return v !== null && v !== false;
}

function isObj(v: JV): v is Record<string, JV> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEq(a: JV, b: JV): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
		return true;
	}
	if (isObj(a) && isObj(b)) {
		const ak = Object.keys(a), bk = Object.keys(b);
		if (ak.length !== bk.length) return false;
		for (const k of ak) if (!deepEq(a[k], b[k])) return false;
		return true;
	}
	return false;
}

function jqCompare(a: JV, b: JV): number {
	const order = ['null', 'boolean', 'number', 'string', 'array', 'object'];
	const ta = typeOf(a), tb = typeOf(b);
	if (ta !== tb) return order.indexOf(ta) - order.indexOf(tb);
	if (a === null) return 0;
	if (typeof a === 'boolean') return (a === b ? 0 : a ? 1 : -1);
	if (typeof a === 'number') return (a as number) - (b as number);
	if (typeof a === 'string') return (a as string).localeCompare(b as string);
	if (Array.isArray(a) && Array.isArray(b)) {
		const len = Math.min(a.length, (b as JV[]).length);
		for (let i = 0; i < len; i++) {
			const c = jqCompare(a[i], (b as JV[])[i]);
			if (c !== 0) return c;
		}
		return a.length - (b as JV[]).length;
	}
	if (isObj(a) && isObj(b)) {
		const ak = Object.keys(a).sort(), bk = Object.keys(b as object).sort();
		for (let i = 0; i < Math.min(ak.length, bk.length); i++) {
			const kc = ak[i]!.localeCompare(bk[i]!);
			if (kc !== 0) return kc;
			const vc = jqCompare(a[ak[i]!], (b as Record<string,JV>)[bk[i]!]);
			if (vc !== 0) return vc;
		}
		return ak.length - bk.length;
	}
	return 0;
}

function jqAdd(a: JV, b: JV): JV {
	if (a === null) return b;
	if (b === null) return a;
	if (typeof a === 'number' && typeof b === 'number') return a + b;
	if (typeof a === 'string' && typeof b === 'string') return a + b;
	if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
	if (isObj(a) && isObj(b)) return { ...a, ...b };
	err(`${typeOf(a)} and ${typeOf(b)} cannot be added`);
}

function jqSub(a: JV, b: JV): JV {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (Array.isArray(a) && Array.isArray(b)) return (a as JV[]).filter(x => !(b as JV[]).some(y => deepEq(x, y)));
	err(`${typeOf(a)} and ${typeOf(b)} cannot be subtracted`);
}

function jqMul(a: JV, b: JV): JV {
	if (typeof a === 'number' && typeof b === 'number') return a * b;
	if (typeof a === 'string' && typeof b === 'number') return b < 1 ? null : a.repeat(b);
	if (typeof a === 'number' && typeof b === 'string') return a < 1 ? null : b.repeat(a);
	if (isObj(a) && isObj(b)) {
		function mergeDeep(x: Record<string,JV>, y: Record<string,JV>): JV {
			const r = { ...x };
			for (const k of Object.keys(y)) {
				if (isObj(r[k]) && isObj(y[k])) r[k] = mergeDeep(r[k] as Record<string,JV>, y[k] as Record<string,JV>);
				else r[k] = y[k]!;
			}
			return r;
		}
		return mergeDeep(a, b as Record<string,JV>);
	}
	err(`${typeOf(a)} and ${typeOf(b)} cannot be multiplied`);
}

function jqDiv(a: JV, b: JV): JV {
	if (typeof a === 'number' && typeof b === 'number') {
		if (b === 0) err('number (0) and number cannot be divided because the divisor is zero');
		return a / b;
	}
	if (typeof a === 'string' && typeof b === 'string') {
		if (b === '') err('string ("") and string cannot be divided because the divisor is empty');
		return (a as string).split(b as string);
	}
	err(`${typeOf(a)} and ${typeOf(b)} cannot be divided`);
}

function jqMod(a: JV, b: JV): JV {
	if (typeof a === 'number' && typeof b === 'number') {
		if (b === 0) err('number (0) cannot be used as modulus');
		return a % b;
	}
	err(`${typeOf(a)} and ${typeOf(b)} cannot be used with modulus`);
}

function collect(it: Iterable<JV>): JV[] { return [...it]; }

// ─── Path utilities ───────────────────────────────────────────────────────────

type Path = (string | number)[];

function getPath(obj: JV, path: Path): JV {
	let cur = obj;
	for (const k of path) {
		if (cur === null || cur === undefined) return null;
		if (typeof k === 'number') {
			if (!Array.isArray(cur)) err(`null (null) and number (${k}) cannot be added`);
			cur = (cur as JV[])[k < 0 ? (cur as JV[]).length + k : k] ?? null;
		} else {
			if (!isObj(cur)) err(`null (null) and string ("${k}") cannot be added`);
			cur = (cur as Record<string,JV>)[k] ?? null;
		}
	}
	return cur;
}

function setPath(obj: JV, path: Path, val: JV): JV {
	if (path.length === 0) return val;
	const [head, ...rest] = path;
	if (typeof head === 'number') {
		const arr = Array.isArray(obj) ? [...obj as JV[]] : Array.from({ length: (head as number) + 1 }, () => null as JV);
		const idx = (head as number) < 0 ? arr.length + (head as number) : (head as number);
		while (arr.length <= idx) arr.push(null);
		arr[idx] = setPath(arr[idx] ?? null, rest, val);
		return arr;
	} else {
		const o = isObj(obj) ? { ...obj as Record<string,JV> } : {} as Record<string,JV>;
		o[head as string] = setPath(o[head as string] ?? null, rest, val);
		return o;
	}
}

function delPath(obj: JV, path: Path): JV {
	if (path.length === 0) err('cannot delete root');
	const [head, ...rest] = path;
	if (typeof head === 'number') {
		if (!Array.isArray(obj)) return obj;
		const arr = [...obj as JV[]];
		const idx = (head as number) < 0 ? arr.length + (head as number) : (head as number);
		if (rest.length === 0) { arr.splice(idx, 1); return arr; }
		arr[idx] = delPath(arr[idx] ?? null, rest);
		return arr;
	} else {
		if (!isObj(obj)) return obj;
		const o = { ...obj as Record<string,JV> };
		if (rest.length === 0) { delete o[head as string]; return o; }
		o[head as string] = delPath(o[head as string] ?? null, rest);
		return o;
	}
}

function* collectPaths(node: JV, curPath: Path, filter: ((v: JV) => boolean) | null): Iterable<Path> {
	// `paths` (filter === null) yields EVERY path to a non-root node; with a
	// filter (`leaf_paths`, `paths(f)`) it yields only paths whose node matches.
	if (curPath.length > 0 && (filter === null || filter(node))) {
		yield [...curPath];
	}
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) yield* collectPaths(node[i]!, [...curPath, i], filter);
	} else if (isObj(node)) {
		for (const k of Object.keys(node)) yield* collectPaths(node[k]!, [...curPath, k], filter);
	}
}

// ─── Format strings (@base64, etc.) ──────────────────────────────────────────

function applyFormat(fmt: string, v: JV): string {
	const s = typeof v === 'string' ? v : JSON.stringify(v);
	switch (fmt) {
		case 'text': return s;
		case 'json': return JSON.stringify(v);
		case 'html': return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
		case 'uri': return encodeURIComponent(s);
		case 'csv': {
			if (!Array.isArray(v)) err('@csv input must be an array');
			return (v as JV[]).map(x => typeof x === 'string' ? '"' + x.replace(/"/g,'""') + '"' : String(x)).join(',');
		}
		case 'tsv': {
			if (!Array.isArray(v)) err('@tsv input must be an array');
			return (v as JV[]).map(x => typeof x === 'string' ? x.replace(/\\/g,'\\\\').replace(/\t/g,'\\t').replace(/\n/g,'\\n').replace(/\r/g,'\\r') : String(x)).join('\t');
		}
		case 'sh': return "'" + s.replace(/'/g,"'\\''") + "'";
		case 'base64': return btoa(s);
		case 'base64d': {
			try { return atob(s); } catch { return err('@base64d: invalid base64'); }
		}
		default: err(`unknown format: @${fmt}`);
	}
}

// ─── Built-ins ────────────────────────────────────────────────────────────────

function makeEnv(): Env {
	const fns = new Map<string, FnDef>();

	// Builtins are keyed by `name/arity` (e.g. `range/1`, `range/3`) so that
	// multi-arity functions all coexist and dispatch correctly — jq overloads on
	// arity. `reg` takes a fully-qualified key; reg0/reg1/reg2 derive it from the
	// argument count.
	function reg(key: string, fn: (args: AST[], input: JV, env: Env) => Iterable<JV>) {
		fns.set(key, { kind: 'builtin', fn });
	}

	// Helpers for 0/1/2 arg builtins
	function reg0(n: string, fn: (v: JV) => Iterable<JV>) {
		reg(`${n}/0`, (_args, v, _env) => fn(v));
	}
	function reg1(n: string, fn: (v: JV, arg: AST, env: Env) => Iterable<JV>) {
		reg(`${n}/1`, ([a]: AST[], v, env) => fn(v, a!, env));
	}
	function reg2(n: string, fn: (v: JV, a: AST, b: AST, env: Env) => Iterable<JV>) {
		reg(`${n}/2`, ([a, b]: AST[], v, env) => fn(v, a!, b!, env));
	}

	// ── Basic ─────────────────────────────────────────────────────────────────
	reg0('empty', function*() {});
	reg0('length', function*(v) {
		if (v === null) yield 0;
		else if (typeof v === 'number') yield Math.abs(v as number);
		else if (typeof v === 'string') yield (v as string).length;
		else if (Array.isArray(v)) yield (v as JV[]).length;
		else if (isObj(v)) yield Object.keys(v).length;
		else err(`${typeOf(v)} has no length`);
	});
	reg0('utf8bytelength', function*(v) {
		if (typeof v !== 'string') err('utf8bytelength requires a string');
		yield new TextEncoder().encode(v as string).length;
	});
	reg0('type', function*(v) { yield typeOf(v); });
	reg0('infinite', function*() { yield Infinity; });
	reg0('nan', function*() { yield NaN; });
	reg0('isinfinite', function*(v) { yield !isFinite(v as number) && !isNaN(v as number); });
	reg0('isnan', function*(v) { yield isNaN(v as number); });
	reg0('isnormal', function*(v) { yield isFinite(v as number) && !isNaN(v as number) && v !== 0; });
	reg0('isfinite', function*(v) { yield isFinite(v as number) && !isNaN(v as number); });
	reg0('not', function*(v) { yield !jqTruthy(v); });
	reg0('keys', function*(v) {
		if (Array.isArray(v)) yield Array.from({length: (v as JV[]).length}, (_,i) => i);
		else if (isObj(v)) yield Object.keys(v).sort();
		else err(`${typeOf(v)} has no keys`);
	});
	reg0('keys_unsorted', function*(v) {
		if (Array.isArray(v)) yield Array.from({length: (v as JV[]).length}, (_,i) => i);
		else if (isObj(v)) yield Object.keys(v);
		else err(`${typeOf(v)} has no keys`);
	});
	reg0('values', function*(v) {
		if (Array.isArray(v)) yield* (v as JV[]);
		else if (isObj(v)) yield Object.values(v);
		else err(`${typeOf(v)} has no values`);
	});
	reg0('to_entries', function*(v) {
		if (Array.isArray(v)) yield (v as JV[]).map((val, i) => ({ key: i, value: val }));
		else if (isObj(v)) yield Object.entries(v).map(([k, val]) => ({ key: k, value: val }));
		else err('to_entries requires an object or array');
	});
	reg0('from_entries', function*(v) {
		if (!Array.isArray(v)) err('from_entries requires an array');
		const obj: Record<string, JV> = {};
		for (const e of v as JV[]) {
			if (!isObj(e)) err('from_entries: each entry must be an object');
			const kv = e as Record<string,JV>;
			const key = String(kv['key'] ?? kv['name'] ?? kv['Key'] ?? kv['Name'] ?? '');
			obj[key] = kv['value'] ?? null;
		}
		yield obj;
	});
	reg0('add', function*(v) {
		if (v === null) yield null;
		else if (!Array.isArray(v)) err('add requires an array');
		else {
			const arr = v as JV[];
			if (arr.length === 0) yield null;
			else yield arr.reduce((acc, x) => jqAdd(acc, x));
		}
	});
	reg0('flatten', function*(v) {
		function flat(x: JV): JV[] {
			if (!Array.isArray(x)) return [x];
			return (x as JV[]).flatMap(flat);
		}
		if (!Array.isArray(v)) err('flatten requires an array');
		yield flat(v);
	});
	reg0('sort', function*(v) {
		if (!Array.isArray(v)) err('sort requires an array');
		yield [...v as JV[]].sort(jqCompare);
	});
	reg0('reverse', function*(v) {
		if (!Array.isArray(v)) err('reverse requires an array');
		yield [...v as JV[]].reverse();
	});
	reg0('unique', function*(v) {
		if (!Array.isArray(v)) err('unique requires an array');
		const sorted = [...v as JV[]].sort(jqCompare);
		const res: JV[] = [];
		for (let i = 0; i < sorted.length; i++) {
			if (i === 0 || !deepEq(sorted[i], sorted[i-1])) res.push(sorted[i]!);
		}
		yield res;
	});
	reg0('min', function*(v) {
		if (!Array.isArray(v)) err('min requires an array');
		if ((v as JV[]).length === 0) yield null;
		else yield (v as JV[]).reduce((m, x) => jqCompare(x, m) < 0 ? x : m);
	});
	reg0('max', function*(v) {
		if (!Array.isArray(v)) err('max requires an array');
		if ((v as JV[]).length === 0) yield null;
		else yield (v as JV[]).reduce((m, x) => jqCompare(x, m) > 0 ? x : m);
	});
	reg0('tostring', function*(v) {
		if (typeof v === 'string') yield v;
		else yield JSON.stringify(v);
	});
	reg0('tonumber', function*(v) {
		if (typeof v === 'number') yield v;
		else if (typeof v === 'string') {
			const n = Number(v as string);
			if (isNaN(n)) err(`Invalid numeric literal at EOF at line 1, column ${(v as string).length + 1} (while parsing '${v}')`);
			yield n;
		} else err(`${typeOf(v)} cannot be converted to a number`);
	});
	reg0('tojson', function*(v) { yield JSON.stringify(v); });
	reg0('fromjson', function*(v) {
		if (typeof v !== 'string') err('fromjson requires a string');
		try { yield JSON.parse(v as string); } catch { err(`Invalid JSON: ${v}`); }
	});
	reg0('ascii_downcase', function*(v) {
		if (typeof v !== 'string') err('ascii_downcase requires a string');
		yield (v as string).toLowerCase();
	});
	reg0('ascii_upcase', function*(v) {
		if (typeof v !== 'string') err('ascii_upcase requires a string');
		yield (v as string).toUpperCase();
	});
	reg0('explode', function*(v) {
		if (typeof v !== 'string') err('explode requires a string');
		yield [...v as string].map(c => c.codePointAt(0)!);
	});
	reg0('implode', function*(v) {
		if (!Array.isArray(v)) err('implode requires an array');
		yield (v as number[]).map(n => String.fromCodePoint(n)).join('');
	});
	reg0('ascii', function*(v) {
		if (typeof v !== 'number') err('ascii requires a number');
		yield String.fromCodePoint(v as number);
	});
	reg0('floor', function*(v) { yield Math.floor(v as number); });
	reg0('ceil', function*(v) { yield Math.ceil(v as number); });
	reg0('round', function*(v) { yield Math.round(v as number); });
	reg0('sqrt', function*(v) { yield Math.sqrt(v as number); });
	reg0('fabs', function*(v) { yield Math.abs(v as number); });
	reg0('log', function*(v) { yield Math.log(v as number); });
	reg0('log2', function*(v) { yield Math.log2(v as number); });
	reg0('log10', function*(v) { yield Math.log10(v as number); });
	reg0('exp', function*(v) { yield Math.exp(v as number); });
	reg0('exp2', function*(v) { yield Math.pow(2, v as number); });
	reg0('exp10', function*(v) { yield Math.pow(10, v as number); });
	reg0('significand', function*(v) {
		const n = v as number;
		if (n === 0) yield 0;
		else { const e = Math.floor(Math.log2(Math.abs(n))); yield n / Math.pow(2, e); }
	});
	reg0('exponent', function*(v) {
		const n = v as number;
		if (n === 0) yield 0;
		else yield Math.floor(Math.log2(Math.abs(n)));
	});
	reg0('tgamma', function*(v) {
		// Lanczos approximation
		function gamma(n: number): number {
			if (n < 0.5) return Math.PI / (Math.sin(Math.PI * n) * gamma(1 - n));
			n -= 1;
			let x = 0.99999999999980993;
			const c = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
			for (let i = 0; i < 8; i++) x += c[i]! / (n + i + 1);
			const t = n + 7.5;
			return Math.sqrt(2 * Math.PI) * Math.pow(t, n + 0.5) * Math.exp(-t) * x;
		}
		yield gamma(v as number);
	});
	reg0('env', function*() { yield {}; }); // browser: no env
	reg0('builtins', function*() {
		// Keys are already `name/arity`.
		yield [...fns.keys()].sort();
	});
	reg0('paths', function*(v) {
		for (const p of collectPaths(v, [], null)) yield p;
	});
	reg0('leaf_paths', function*(v) {
		for (const p of collectPaths(v, [], v => v === null || typeof v !== 'object')) yield p;
	});
	reg0('to_date', function*(v) {
		if (typeof v !== 'number') err('to_date requires a number');
		yield new Date((v as number) * 1000).toISOString();
	});
	reg0('fromdate', function*(v) {
		if (typeof v !== 'string') err('fromdate requires a string');
		yield new Date(v as string).getTime() / 1000;
	});
	reg0('now', function*() { yield Date.now() / 1000; });
	reg0('debug', function*(v) { console.debug('[jq debug]', v); yield v; });
	reg0('stderr', function*(v) { console.warn('[jq stderr]', v); yield v; });
	reg0('input', function*() { err('input is not available in the browser'); });
	reg0('inputs', function*() { err('inputs is not available in the browser'); });
	reg0('error', function*(v) { err(typeof v === 'string' ? v as string : JSON.stringify(v)); });
	reg0('recurse', function*(v) {
		function* rec(x: JV): Iterable<JV> {
			yield x;
			if (Array.isArray(x)) for (const e of x as JV[]) yield* rec(e);
			else if (isObj(x)) for (const k of Object.keys(x)) yield* rec((x as Record<string,JV>)[k]!);
		}
		yield* rec(v);
	});
	reg0('recurse_down', function*(v) {
		function* rec(x: JV): Iterable<JV> {
			yield x;
			if (Array.isArray(x)) for (const e of x as JV[]) yield* rec(e);
			else if (isObj(x)) for (const k of Object.keys(x)) yield* rec((x as Record<string,JV>)[k]!);
		}
		yield* rec(v);
	});
	reg0('indices', function*() { err('indices requires an argument'); });
	reg0('contains', function*() { err('contains requires an argument'); });
	reg0('inside', function*() { err('inside requires an argument'); });
	reg0('has', function*() { err('has requires an argument'); });
	reg0('in', function*() { err('in requires an argument'); });
	reg0('split', function*() { err('split requires an argument'); });
	reg0('test', function*() { err('test requires an argument'); });
	reg0('map', function*() { err('map requires an argument'); });
	reg0('map_values', function*() { err('map_values requires an argument'); });
	reg0('select', function*() { err('select requires an argument'); });
	reg0('sort_by', function*() { err('sort_by requires an argument'); });
	reg0('unique_by', function*() { err('unique_by requires an argument'); });
	reg0('group_by', function*() { err('group_by requires an argument'); });
	reg0('min_by', function*() { err('min_by requires an argument'); });
	reg0('max_by', function*() { err('max_by requires an argument'); });
	reg0('del', function*() { err('del requires an argument'); });
	reg0('limit', function*() { err('limit requires two arguments'); });
	reg0('first', function*(v) {
		if (!Array.isArray(v)) err(`Cannot index ${typeOf(v)} with number`);
		yield (v as JV[]).length > 0 ? (v as JV[])[0] : null;
	});
	reg0('last', function*(v) {
		if (!Array.isArray(v)) err(`Cannot index ${typeOf(v)} with number`);
		const arr = v as JV[];
		yield arr.length > 0 ? arr[arr.length - 1] : null;
	});
	reg0('nth', function*() { err('nth requires arguments'); });
	reg0('any', function*(v) {
		if (!Array.isArray(v)) err('any requires an array');
		yield (v as JV[]).some(x => !!x);
	});
	reg0('all', function*(v) {
		if (!Array.isArray(v)) err('all requires an array');
		yield (v as JV[]).every(x => !!x);
	});
	reg0('range', function*() { err('range requires an argument'); });
	reg0('while', function*() { err('while requires arguments'); });
	reg0('until', function*() { err('until requires arguments'); });
	reg0('repeat', function*() { err('repeat requires an argument'); });
	reg0('walk', function*() { err('walk requires an argument'); });
	reg0('paths_with', function*() { err('paths requires an optional argument'); });
	reg0('with_entries', function*() { err('with_entries requires an argument'); });
	reg0('ltrimstr', function*() { err('ltrimstr requires an argument'); });
	reg0('rtrimstr', function*() { err('rtrimstr requires an argument'); });
	reg0('startswith', function*() { err('startswith requires an argument'); });
	reg0('endswith', function*() { err('endswith requires an argument'); });
	reg0('join', function*() { err('join requires an argument'); });
	reg0('match', function*() { err('match requires an argument'); });
	reg0('capture', function*() { err('capture requires an argument'); });
	reg0('scan', function*() { err('scan requires an argument'); });
	reg0('sub', function*() { err('sub requires arguments'); });
	reg0('gsub', function*() { err('gsub requires arguments'); });
	reg0('splits', function*() { err('splits requires an argument'); });
	reg0('index', function*() { err('index requires an argument'); });
	reg0('rindex', function*() { err('rindex requires an argument'); });
	reg0('pow', function*() { err('pow requires an argument'); });
	reg0('remainder', function*() { err('remainder requires arguments'); });
	reg0('modulemeta', function*() { yield {}; });
	reg0('path', function*() { err('path requires an argument in parens'); });
	reg0('getpath', function*() { err('getpath requires an argument'); });
	reg0('setpath', function*() { err('setpath requires arguments'); });
	reg0('delpaths', function*() { err('delpaths requires an argument'); });
	reg0('isvalid', function*(v) { yield v !== null; });
	reg0('ascii', function*() { err('ascii requires a number argument'); });
	reg0('lstrip', function*(v) {
		if (typeof v !== 'string') err('lstrip requires a string');
		yield (v as string).trimStart();
	});
	reg0('rstrip', function*(v) {
		if (typeof v !== 'string') err('rstrip requires a string');
		yield (v as string).trimEnd();
	});
	reg0('strip', function*(v) {
		if (typeof v !== 'string') err('strip requires a string');
		yield (v as string).trim();
	});
	reg0('indices', function*() { err('indices requires an argument'); });

	// 1-arg builtins
	reg1('has', function*(v, arg, env) {
		const key = firstOf(evalNode(arg, v, env));
		if (isObj(v)) yield Object.prototype.hasOwnProperty.call(v, key as PropertyKey);
		else if (Array.isArray(v)) yield typeof key === 'number' && key >= 0 && (key as number) < (v as JV[]).length;
		else err(`null (${typeOf(v)}) and ${typeOf(key)} (${JSON.stringify(key)}) cannot be checked for membership`);
	});
	reg1('in', function*(v, arg, env) {
		const obj = firstOf(evalNode(arg, v, env));
		if (isObj(obj)) yield Object.prototype.hasOwnProperty.call(obj, v as PropertyKey);
		else if (Array.isArray(obj)) yield (obj as JV[]).some(x => deepEq(x, v));
		else err(`${typeOf(v)} and ${typeOf(obj)} cannot be checked for inclusion`);
	});
	reg1('contains', function*(v, arg, env) {
		const sub = firstOf(evalNode(arg, v, env));
		yield jqContains(v, sub);
	});
	reg1('inside', function*(v, arg, env) {
		const outer = firstOf(evalNode(arg, v, env));
		yield jqContains(outer, v);
	});
	reg1('select', function*(v, arg, env) {
		const cond = firstOf(evalNode(arg, v, env));
		if (jqTruthy(cond)) yield v;
	});
	reg1('map', function*(v, arg, env) {
		if (!Array.isArray(v)) err('map requires an array');
		const res: JV[] = [];
		for (const x of v as JV[]) res.push(...evalNode(arg, x, env));
		yield res;
	});
	reg1('map_values', function*(v, arg, env) {
		if (Array.isArray(v)) {
			yield (v as JV[]).map(x => firstOf(evalNode(arg, x, env)));
		} else if (isObj(v)) {
			const res: Record<string, JV> = {};
			for (const k of Object.keys(v)) res[k] = firstOf(evalNode(arg, (v as Record<string,JV>)[k]!, env));
			yield res;
		} else err('map_values requires an array or object');
	});
	reg1('sort_by', function*(v, arg, env) {
		if (!Array.isArray(v)) err('sort_by requires an array');
		const keyed = (v as JV[]).map(x => ({ v: x, k: firstOf(evalNode(arg, x, env)) }));
		keyed.sort((a, b) => jqCompare(a.k, b.k));
		yield keyed.map(x => x.v);
	});
	reg1('group_by', function*(v, arg, env) {
		if (!Array.isArray(v)) err('group_by requires an array');
		const keyed = (v as JV[]).map(x => ({ v: x, k: firstOf(evalNode(arg, x, env)) }));
		keyed.sort((a, b) => jqCompare(a.k, b.k));
		const res: JV[][] = [];
		let cur: JV[] = [];
		let prevKey: JV = Symbol() as unknown as JV; // sentinel
		for (const { v: val, k } of keyed) {
			if (cur.length > 0 && !deepEq(k, prevKey)) { res.push(cur); cur = []; }
			cur.push(val); prevKey = k;
		}
		if (cur.length > 0) res.push(cur);
		yield res;
	});
	reg1('unique_by', function*(v, arg, env) {
		if (!Array.isArray(v)) err('unique_by requires an array');
		const keyed = (v as JV[]).map(x => ({ v: x, k: firstOf(evalNode(arg, x, env)) }));
		keyed.sort((a, b) => jqCompare(a.k, b.k));
		const res: JV[] = [];
		let prevKey: JV = Symbol() as unknown as JV;
		for (const { v: val, k } of keyed) {
			if (res.length === 0 || !deepEq(k, prevKey)) { res.push(val); prevKey = k; }
		}
		yield res;
	});
	reg1('min_by', function*(v, arg, env) {
		if (!Array.isArray(v)) err('min_by requires an array');
		if ((v as JV[]).length === 0) yield null;
		else {
			let best: JV = (v as JV[])[0] as JV;
			let bestKey: JV = firstOf(evalNode(arg, best, env));
			for (const x of (v as JV[]).slice(1)) {
				const k: JV = firstOf(evalNode(arg, x, env));
				if (jqCompare(k, bestKey) < 0) { best = x as JV; bestKey = k; }
			}
			yield best;
		}
	});
	reg1('max_by', function*(v, arg, env) {
		if (!Array.isArray(v)) err('max_by requires an array');
		if ((v as JV[]).length === 0) yield null;
		else {
			let best: JV = (v as JV[])[0] as JV;
			let bestKey: JV = firstOf(evalNode(arg, best, env));
			for (const x of (v as JV[]).slice(1)) {
				const k: JV = firstOf(evalNode(arg, x, env));
				if (jqCompare(k, bestKey) > 0) { best = x as JV; bestKey = k; }
			}
			yield best;
		}
	});
	reg1('with_entries', function*(v, arg, env) {
		if (Array.isArray(v)) {
			const entries = (v as JV[]).map((val, i) => ({ key: i, value: val }));
			const res: JV[] = [];
			for (const e of entries) res.push(...evalNode(arg, e, env));
			yield Object.fromEntries(res.map((e: JV) => {
				const kv = e as Record<string, JV>;
				return [String(kv['key'] ?? kv['name'] ?? ''), kv['value'] ?? null];
			}));
		} else if (isObj(v)) {
			const entries = Object.entries(v as Record<string,JV>).map(([k, val]) => ({ key: k, value: val }));
			const res: JV[] = [];
			for (const e of entries) res.push(...evalNode(arg, e, env));
			const out: Record<string, JV> = {};
			for (const e of res) {
				const kv = e as Record<string, JV>;
				out[String(kv['key'] ?? kv['name'] ?? '')] = kv['value'] ?? null;
			}
			yield out;
		} else err('with_entries requires an array or object');
	});
	reg1('del', function*(v, arg, env) {
		// Collect paths to delete, then delete them in reverse order
		const paths = [...collectPathsFromExpr(arg, v, env)];
		// Sort in reverse so deeper paths don't affect shallower ones
		paths.sort((a, b) => b.length - a.length || 0);
		let result = v;
		for (const p of paths) result = delPath(result, p);
		yield result;
	});
	reg1('any', function*(v, arg, env) {
		if (!Array.isArray(v)) err('any(f) requires an array');
		for (const x of v as JV[]) {
			const r = firstOf(evalNode(arg, x, env));
			if (r) { yield true; return; }
		}
		yield false;
	});
	reg1('all', function*(v, arg, env) {
		if (!Array.isArray(v)) err('all(f) requires an array');
		for (const x of v as JV[]) {
			const r = firstOf(evalNode(arg, x, env));
			if (!r) { yield false; return; }
		}
		yield true;
	});
	reg1('flatten', function*(v, arg, env) {
		if (!Array.isArray(v)) err('flatten requires an array');
		const depth = Number(firstOf(evalNode(arg, v, env)));
		// Flatten the input array's nested arrays by up to `depth` levels.
		function flat(arr: JV[], d: number): JV[] {
			const out: JV[] = [];
			for (const e of arr) {
				if (Array.isArray(e) && d > 0) out.push(...flat(e as JV[], d - 1));
				else out.push(e);
			}
			return out;
		}
		yield flat(v as JV[], depth);
	});
	reg1('indices', function*(v, arg, env) {
		const sub = firstOf(evalNode(arg, v, env));
		if (typeof v === 'string') {
			const s = v as string, p = sub as string;
			const res: number[] = [];
			let i = s.indexOf(p);
			while (i !== -1) { res.push(i); i = s.indexOf(p, i + 1); }
			yield res;
		} else if (Array.isArray(v)) {
			const res: number[] = [];
			if (Array.isArray(sub)) {
				for (let i = 0; i <= (v as JV[]).length - (sub as JV[]).length; i++) {
					let match = true;
					for (let j = 0; j < (sub as JV[]).length; j++) {
						if (!deepEq((v as JV[])[i+j], (sub as JV[])[j])) { match = false; break; }
					}
					if (match) res.push(i);
				}
			} else {
				for (let i = 0; i < (v as JV[]).length; i++) {
					if (deepEq((v as JV[])[i], sub)) res.push(i);
				}
			}
			yield res;
		} else err('indices requires a string or array');
	});
	reg1('index', function*(v, arg, env) {
		const sub = firstOf(evalNode(arg, v, env));
		if (typeof v === 'string') {
			const i = (v as string).indexOf(sub as string);
			yield i === -1 ? null : i;
		} else if (Array.isArray(v)) {
			const i = (v as JV[]).findIndex(x => deepEq(x, sub));
			yield i === -1 ? null : i;
		} else err('index requires a string or array');
	});
	reg1('rindex', function*(v, arg, env) {
		const sub = firstOf(evalNode(arg, v, env));
		if (typeof v === 'string') {
			const i = (v as string).lastIndexOf(sub as string);
			yield i === -1 ? null : i;
		} else if (Array.isArray(v)) {
			const arr = v as JV[];
			for (let i = arr.length - 1; i >= 0; i--) {
				if (deepEq(arr[i], sub)) { yield i; return; }
			}
			yield null;
		} else err('rindex requires a string or array');
	});
	reg1('split', function*(v, arg, env) {
		if (typeof v !== 'string') err('split requires a string');
		const sep = firstOf(evalNode(arg, v, env));
		yield (v as string).split(sep as string);
	});
	reg1('join', function*(v, arg, env) {
		if (!Array.isArray(v)) err('join requires an array');
		const sep = String(firstOf(evalNode(arg, v, env)));
		yield (v as JV[]).map(x => x === null ? '' : typeof x === 'string' ? x : JSON.stringify(x)).join(sep);
	});
	reg1('ltrimstr', function*(v, arg, env) {
		if (typeof v !== 'string') err('ltrimstr requires a string');
		const prefix = String(firstOf(evalNode(arg, v, env)));
		yield (v as string).startsWith(prefix) ? (v as string).slice(prefix.length) : v;
	});
	reg1('rtrimstr', function*(v, arg, env) {
		if (typeof v !== 'string') err('rtrimstr requires a string');
		const suffix = String(firstOf(evalNode(arg, v, env)));
		yield (v as string).endsWith(suffix) ? (v as string).slice(0, (v as string).length - suffix.length) : v;
	});
	reg1('startswith', function*(v, arg, env) {
		if (typeof v !== 'string') err('startswith requires a string');
		yield (v as string).startsWith(String(firstOf(evalNode(arg, v, env))));
	});
	reg1('endswith', function*(v, arg, env) {
		if (typeof v !== 'string') err('endswith requires a string');
		yield (v as string).endsWith(String(firstOf(evalNode(arg, v, env))));
	});
	reg1('test', function*(v, arg, env) {
		if (typeof v !== 'string') err('test requires a string');
		const re = firstOf(evalNode(arg, v, env)) as string;
		yield compileRegex(re).test(v as string);
	});
	reg1('match', function*(v, arg, env) {
		if (typeof v !== 'string') err('match requires a string');
		const re = firstOf(evalNode(arg, v, env)) as string;
		const m = (v as string).match(compileRegex(re));
		if (!m) yield null;
		else yield {
			offset: m.index ?? 0,
			length: m[0]!.length,
			string: m[0],
			captures: m.slice(1).map((c) => ({ offset: -1, length: c?.length ?? -1, string: c ?? null, name: null })),
		};
	});
	reg1('capture', function*(v, arg, env) {
		if (typeof v !== 'string') err('capture requires a string');
		const re = firstOf(evalNode(arg, v, env)) as string;
		const m = (v as string).match(compileRegex(re));
		if (!m || !m.groups) yield {};
		else yield m.groups as Record<string, string>;
	});
	reg1('scan', function*(v, arg, env) {
		if (typeof v !== 'string') err('scan requires a string');
		const re = firstOf(evalNode(arg, v, env)) as string;
		const regex = compileRegex(re, 'g');
		let m: RegExpExecArray | null;
		while ((m = regex.exec(v as string)) !== null) {
			if (m.length > 1) yield m.slice(1);
			else yield m[0];
		}
	});
	reg1('splits', function*(v, arg, env) {
		if (typeof v !== 'string') err('splits requires a string');
		const re = firstOf(evalNode(arg, v, env)) as string;
		yield* (v as string).split(compileRegex(re));
	});
	reg1('pow', function*(v, arg, env) {
		const exp = firstOf(evalNode(arg, v, env)) as number;
		yield Math.pow(v as number, exp);
	});
	// jq's standard pow is two-arg: pow(x; y) == x ** y, independent of input.
	reg2('pow', function*(v, xArg, yArg, env) {
		const x = firstOf(evalNode(xArg, v, env)) as number;
		const y = firstOf(evalNode(yArg, v, env)) as number;
		yield Math.pow(x, y);
	});
	// repeat(f): emit f against the original input forever (bounded by an
	// enclosing limit() or the engine's output cap).
	reg1('repeat', function*(v, arg, env) {
		for (;;) yield* evalNode(arg, v, env);
	});
	reg1('remainder', function*(v, arg, env) {
		const b = firstOf(evalNode(arg, v, env)) as number;
		yield (v as number) % b;
	});
	reg1('walk', function*(v, arg, env) {
		function walk(x: JV): JV {
			let val: JV = x;
			if (Array.isArray(x)) val = (x as JV[]).map(walk);
			else if (isObj(x)) {
				const o: Record<string, JV> = {};
				for (const k of Object.keys(x)) o[k] = walk((x as Record<string, JV>)[k]!);
				val = o;
			}
			return firstOf(evalNode(arg, val, env));
		}
		yield walk(v);
	});
	reg1('paths', function*(v, arg, env) {
		for (const p of collectPaths(v, [], null)) {
			const pv = getPath(v, p);
			try {
				const ok = firstOf(evalNode(arg, pv, env));
				if (ok) yield p;
			} catch { /* skip */ }
		}
	});
	reg1('recurse', function*(v, arg, env) {
		function* rec(x: JV): Iterable<JV> {
			yield x;
			for (const next of evalNode(arg, x, env)) {
				yield* rec(next);
			}
		}
		yield* rec(v);
	});
	reg1('isvalid', function*(v, arg, env) {
		try { firstOf(evalNode(arg, v, env)); yield true; } catch { yield false; }
	});
	reg1('debug', function*(v, arg, env) {
		const msg = firstOf(evalNode(arg, v, env));
		console.debug('[jq debug]', msg, v);
		yield v;
	});
	reg1('error', function*(v, arg, env) {
		const msg = firstOf(evalNode(arg, v, env));
		err(typeof msg === 'string' ? msg as string : JSON.stringify(msg));
	});
	reg1('@base64', function*(v, arg, env) { yield applyFormat('base64', firstOf(evalNode(arg, v, env))); });
	reg1('range', function*(v, arg, env) {
		const n = firstOf(evalNode(arg, v, env)) as number;
		for (let i = 0; i < n; i++) yield i;
	});
	reg1('first', function*(v, arg, env) {
		for (const x of evalNode(arg, v, env)) { yield x; return; }
		err('first: expected at least one output');
	});
	reg1('last', function*(v, arg, env) {
		let last: JV = undefined as unknown as JV; let found = false;
		for (const x of evalNode(arg, v, env)) { last = x; found = true; }
		if (!found) err('last: expected at least one output');
		yield last;
	});
	reg1('nth', function*(v, arg, env) {
		// nth(n) ≡ .[n] — index into the input array.
		const n = Number(firstOf(evalNode(arg, v, env)));
		if (!Array.isArray(v)) err(`Cannot index ${typeOf(v)} with number`);
		const arr = v as JV[];
		yield arr[n] ?? null;
	});
	reg1('limit', function*() { err('limit requires two arguments (limit(n; gen))'); });
	reg1('until', function*(_v, _arg, _env) {
		err('until requires two arguments (until(cond; update))');
	});
	reg1('while', function*() { err('while requires two arguments (while(cond; update))'); });
	reg1('sub', function*() { err('sub requires two arguments'); });
	reg1('gsub', function*() { err('gsub requires two arguments'); });
	// test/1, match/1, scan/1 are the real single-pattern builtins (registered
	// above); their two-argument "with flags" forms are registered below. No
	// stub here — that would shadow the real /1 implementations.

	// 2-arg builtins
	reg2('limit', function*(v, nArg, genArg, env) {
		const n = firstOf(evalNode(nArg, v, env)) as number;
		let count = 0;
		const out: JV[] = [];
		for (const x of evalNode(genArg, v, env)) {
			out.push(x);
			if (++count >= n) break;
		}
		yield* out;
	});
	reg2('until', function*(v, condArg, updateArg, env) {
		let cur = v;
		for (let i = 0; i < 100_000; i++) {
			if (firstOf(evalNode(condArg, cur, env))) { yield cur; return; }
			cur = firstOf(evalNode(updateArg, cur, env));
		}
		err('until: did not converge after 100000 iterations');
	});
	reg2('while', function*(v, condArg, updateArg, env) {
		let cur = v;
		for (let i = 0; i < 100_000; i++) {
			if (!firstOf(evalNode(condArg, cur, env))) return;
			yield cur;
			cur = firstOf(evalNode(updateArg, cur, env));
		}
		err('while: did not terminate after 100000 iterations');
	});
	reg2('recurse', function*(v, filterArg, condArg, env) {
		function* rec(x: JV): Iterable<JV> {
			yield x;
			if (firstOf(evalNode(condArg, x, env))) {
				for (const next of evalNode(filterArg, x, env)) yield* rec(next);
			}
		}
		yield* rec(v);
	});
	reg2('any', function*(v, genArg, condArg, env) {
		for (const x of evalNode(genArg, v, env)) {
			if (firstOf(evalNode(condArg, x, env))) { yield true; return; }
		}
		yield false;
	});
	reg2('all', function*(v, genArg, condArg, env) {
		for (const x of evalNode(genArg, v, env)) {
			if (!firstOf(evalNode(condArg, x, env))) { yield false; return; }
		}
		yield true;
	});
	reg2('range', function*(v, startArg, endArg, env) {
		const start = firstOf(evalNode(startArg, v, env)) as number;
		const end = firstOf(evalNode(endArg, v, env)) as number;
		const step = start <= end ? 1 : -1;
		for (let i = start; step > 0 ? i < end : i > end; i += step) yield i;
	});
	reg2('nth', function*(v, nArg, genArg, env) {
		const n = firstOf(evalNode(nArg, v, env)) as number;
		let count = 0;
		for (const x of evalNode(genArg, v, env)) {
			if (count++ === n) { yield x; return; }
		}
		err('nth: not enough values');
	});
	reg2('sub', function*(v, reArg, replArg, env) {
		if (typeof v !== 'string') err('sub requires a string');
		const re = String(firstOf(evalNode(reArg, v, env)));
		const repl = String(firstOf(evalNode(replArg, v, env)));
		yield (v as string).replace(compileRegex(re), repl);
	});
	reg2('gsub', function*(v, reArg, replArg, env) {
		if (typeof v !== 'string') err('gsub requires a string');
		const re = String(firstOf(evalNode(reArg, v, env)));
		const repl = String(firstOf(evalNode(replArg, v, env)));
		yield (v as string).replace(compileRegex(re, 'g'), repl);
	});
	reg2('test', function*(v, reArg, flagsArg, env) {
		if (typeof v !== 'string') err('test requires a string');
		const re = String(firstOf(evalNode(reArg, v, env)));
		const flags = String(firstOf(evalNode(flagsArg, v, env)));
		yield compileRegex(re, flags).test(v as string);
	});
	reg2('match', function*(v, reArg, flagsArg, env) {
		if (typeof v !== 'string') err('match requires a string');
		const re = String(firstOf(evalNode(reArg, v, env)));
		const flags = String(firstOf(evalNode(flagsArg, v, env)));
		const m = (v as string).match(compileRegex(re, flags));
		if (!m) { yield null; return; }
		yield {
			offset: m.index ?? 0,
			length: m[0]!.length,
			string: m[0],
			captures: m.slice(1).map((c) => ({ offset: -1, length: c?.length ?? -1, string: c ?? null, name: null })),
		};
	});

	// range/3
	reg('range/3', ([nArg, endArg, stepArg]: AST[], v, env) => (function*() {
		const start = firstOf(evalNode(nArg!, v, env)) as number;
		const end = firstOf(evalNode(endArg!, v, env)) as number;
		const step = firstOf(evalNode(stepArg!, v, env)) as number;
		if (step === 0) err('range step cannot be 0');
		for (let i = start; step > 0 ? i < end : i > end; i += step) yield i;
	})());

	return { vars: new Map(), fns };
}

const ROOT_ENV: Env = makeEnv();

function firstOf(it: Iterable<JV>): JV {
	for (const v of it) return v;
	throw new JqEmpty();
}

function jqContains(big: JV, small: JV): boolean {
	if (typeof big === 'string' && typeof small === 'string') return (big as string).includes(small as string);
	if (typeof big === 'number' && typeof small === 'number') return big === small;
	if (typeof big === 'boolean' && typeof small === 'boolean') return big === small;
	if (big === null && small === null) return true;
	if (Array.isArray(big) && Array.isArray(small)) {
		return (small as JV[]).every(s => (big as JV[]).some(b => jqContains(b, s)));
	}
	if (isObj(big) && isObj(small)) {
		return Object.keys(small as object).every(k =>
			Object.prototype.hasOwnProperty.call(big, k) && jqContains((big as Record<string,JV>)[k]!, (small as Record<string,JV>)[k]!)
		);
	}
	return false;
}

function* collectPathsFromExpr(arg: AST, v: JV, env: Env): Iterable<Path> {
	// Collect concrete paths by walking the arg expression as a path expression
	yield* evalPathExpr(arg, v, env, []);
}

function* evalPathExpr(ast: AST, v: JV, env: Env, base: Path): Iterable<Path> {
	switch (ast.t) {
		case 'id': yield base; break;
		case 'field': {
			if (isObj(v)) {
				yield [...base, ast.n];
			}
			break;
		}
		case 'iter': {
			if (Array.isArray(v)) {
				for (let i = 0; i < (v as JV[]).length; i++) yield [...base, i];
			} else if (isObj(v)) {
				for (const k of Object.keys(v as object)) yield [...base, k];
			}
			break;
		}
		case 'pipe': {
			for (const p of evalPathExpr(ast.l, v, env, base)) {
				const mid = getPath(v, p);
				yield* evalPathExpr(ast.r, mid, env, p);
			}
			break;
		}
		case 'comma': {
			// A comma in a path expression is the union of both sides' paths, so
			// `del(.a, .c)` and `(.a, .b) |= f` reach every targeted path.
			yield* evalPathExpr(ast.l, v, env, base);
			yield* evalPathExpr(ast.r, v, env, base);
			break;
		}
		case 'idx': {
			const key = firstOf(evalNode(ast.e, v, env));
			if (typeof key === 'number' || typeof key === 'string') yield [...base, key as string | number];
			break;
		}
		default:
			// fallback: evaluate and use result as a path
			for (const p of evalNode(ast, v, env)) {
				if (Array.isArray(p)) yield p as Path;
			}
	}
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function extendEnv(env: Env, name: string, val: JV): Env {
	const vars = new Map(env.vars);
	vars.set(name, val);
	return { vars, fns: env.fns };
}

function extendEnvFn(env: Env, name: string, def: FnDef): Env {
	const fns = new Map(env.fns);
	fns.set(name, def);
	return { vars: env.vars, fns };
}

function* evalNode(ast: AST, v: JV, env: Env): Iterable<JV> {
	switch (ast.t) {

		case 'id': yield v; break;

		case 'rec': {
			function* rec(x: JV): Iterable<JV> {
				yield x;
				if (Array.isArray(x)) for (const e of x as JV[]) yield* rec(e);
				else if (isObj(x)) for (const k of Object.keys(x as object)) yield* rec((x as Record<string,JV>)[k]!);
			}
			yield* rec(v);
			break;
		}

		case 'lit': yield ast.v; break;

		case 'var': {
			if (!env.vars.has(ast.n)) err(`$${ast.n.slice(1)} is not defined`);
			yield env.vars.get(ast.n)!;
			break;
		}

		case 'field': {
			if (v === null) { if (ast.opt) break; yield null; break; }
			if (!isObj(v)) {
				if (ast.opt) break;
				err(`null (${typeOf(v)}) and string ("${ast.n}") cannot be iterated over`);
			}
			yield (v as Record<string,JV>)[ast.n] ?? null;
			break;
		}

		case 'iter': {
			if (v === null) { if (ast.opt) break; err('null is not iterable'); }
			if (Array.isArray(v)) { yield* v as JV[]; break; }
			if (isObj(v)) { yield* Object.values(v as object) as JV[]; break; }
			if (ast.opt) break;
			return err(`${typeOf(v)} is not iterable`);
		}

		case 'idx': {
			const key = firstOf(evalNode(ast.e, v, env));
			if (typeof key === 'number') {
				if (!Array.isArray(v)) { if (ast.opt) break; err(`${typeOf(v)} cannot be indexed by number`); }
				const arr = v as JV[];
				const i = (key as number) < 0 ? arr.length + (key as number) : (key as number);
				yield arr[i] ?? null;
			} else if (typeof key === 'string') {
				if (v === null) { yield null; break; }
				if (!isObj(v)) { if (ast.opt) break; err(`${typeOf(v)} cannot be indexed by string`); }
				yield (v as Record<string,JV>)[key as string] ?? null;
			} else if (key === null) {
				if (ast.opt) break;
				err('cannot index with null');
			} else {
				if (ast.opt) break;
				err(`cannot index with ${typeOf(key)}`);
			}
			break;
		}

		case 'slice': {
			const src = ast.obj ? firstOf(evalNode(ast.obj, v, env)) : v;
			const lo = ast.lo ? (firstOf(evalNode(ast.lo, v, env)) as number) : null;
			const hi = ast.hi ? (firstOf(evalNode(ast.hi, v, env)) as number) : null;
			if (Array.isArray(src)) {
				const arr = src as JV[];
				const len = arr.length;
				const a = lo === null ? 0 : lo < 0 ? Math.max(0, len + lo) : Math.min(lo, len);
				const b = hi === null ? len : hi < 0 ? Math.max(0, len + hi) : Math.min(hi, len);
				yield arr.slice(a, b);
			} else if (typeof src === 'string') {
				const s = src as string;
				const len = s.length;
				const a = lo === null ? 0 : lo < 0 ? Math.max(0, len + lo) : Math.min(lo, len);
				const b = hi === null ? len : hi < 0 ? Math.max(0, len + hi) : Math.min(hi, len);
				yield s.slice(a, b);
			} else err(`${typeOf(src)} cannot be sliced`);
			break;
		}

		case 'pipe': {
			for (const mid of evalNode(ast.l, v, env)) {
				yield* evalNode(ast.r, mid, env);
			}
			break;
		}

		case 'comma': {
			yield* evalNode(ast.l, v, env);
			yield* evalNode(ast.r, v, env);
			break;
		}

		case 'alt': {
			let hasValue = false;
			for (const x of evalNode(ast.l, v, env)) {
				if (x !== null && x !== false) { yield x; hasValue = true; }
			}
			if (!hasValue) yield* evalNode(ast.r, v, env);
			break;
		}

		case 'add': yield jqAdd(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'sub': yield jqSub(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'mul': yield jqMul(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'div': yield jqDiv(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'mod': yield jqMod(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;

		case 'eq': yield deepEq(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'ne': yield !deepEq(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))); break;
		case 'lt': yield jqCompare(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))) < 0; break;
		case 'le': yield jqCompare(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))) <= 0; break;
		case 'gt': yield jqCompare(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))) > 0; break;
		case 'ge': yield jqCompare(firstOf(evalNode(ast.l, v, env)), firstOf(evalNode(ast.r, v, env))) >= 0; break;

		case 'and': yield jqTruthy(firstOf(evalNode(ast.l, v, env))) && jqTruthy(firstOf(evalNode(ast.r, v, env))); break;
		case 'or': yield jqTruthy(firstOf(evalNode(ast.l, v, env))) || jqTruthy(firstOf(evalNode(ast.r, v, env))); break;
		case 'not': yield !firstOf(evalNode(ast.e, v, env)); break;
		case 'neg': yield -(firstOf(evalNode(ast.e, v, env)) as number); break;

		case 'arr': {
			if (ast.e === null) { yield []; break; }
			yield collect(evalNode(ast.e, v, env));
			break;
		}

		case 'obj': {
			const result: Record<string, JV> = {};
			for (const f of ast.fs) {
				let key: string;
				if (f.computed) {
					key = String(firstOf(evalNode(f.k as AST, v, env)));
				} else if (typeof f.k === 'string') {
					key = f.k;
				} else {
					key = String(firstOf(evalNode(f.k as AST, v, env)));
				}
				const val = f.v === null
					? (firstOf(evalNode({ t: 'field', n: key, opt: false }, v, env)))
					: firstOf(evalNode(f.v, v, env));
				result[key] = val;
			}
			yield result;
			break;
		}

		case 'call': {
			const arity = ast.args.length;
			// Resolve by exact `name/arity` (jq overloads on arity); fall back to a
			// bare-name binding for safety, then a clear "not defined" error.
			const fn = env.fns.get(`${ast.n}/${arity}`) ?? env.fns.get(ast.n);
			if (!fn) err(`${ast.n}/${arity} is not defined`);
			if (fn.kind === 'builtin') {
				yield* fn.fn(ast.args, v, env);
			} else {
				// user-defined function: bind params
				let callEnv = fn.env;
				for (let i = 0; i < fn.params.length; i++) {
					const param = fn.params[i]!;
					if (param.startsWith('$')) {
						// value param
						const val = firstOf(evalNode(ast.args[i] ?? { t: 'id' }, v, env));
						callEnv = extendEnv(callEnv, param, val);
					} else {
						// filter param — capture as a 0-arity lambda, keyed `name/0`.
						const argAst = ast.args[i] ?? { t: 'id' };
						const capturedEnv = env;
						const filterFn: BuiltinFn = {
							kind: 'builtin',
							fn: (_, input, __) => evalNode(argAst, input, capturedEnv),
						};
						callEnv = extendEnvFn(callEnv, `${param}/0`, filterFn);
					}
				}
				yield* evalNode(fn.body, v, callEnv);
			}
			break;
		}

		case 'if': {
			const cond = firstOf(evalNode(ast.c, v, env));
			if (jqTruthy(cond)) yield* evalNode(ast.th, v, env);
			else if (ast.el) yield* evalNode(ast.el, v, env);
			else yield v; // `if C then T end` ≡ `if C then T else . end`
			break;
		}

		case 'try': {
			try {
				yield* evalNode(ast.b, v, env);
			} catch (e) {
				if (e instanceof JqBreak) throw e;
				if (ast.ct) {
					const msg = e instanceof JqError ? e.message : String(e);
					yield* evalNode(ast.ct, msg, env);
				}
				// else: swallow error, produce empty
			}
			break;
		}

		case 'opt': {
			try { yield* evalNode(ast.e, v, env); } catch (e) {
				if (e instanceof JqBreak) throw e;
				// swallow
			}
			break;
		}

		case 'bind': {
			for (const x of evalNode(ast.e, v, env)) {
				const newEnv = extendEnv(env, ast.p, x);
				yield* evalNode(ast.b, v, newEnv);
			}
			break;
		}

		case 'reduce': {
			let acc = firstOf(evalNode(ast.i, v, env));
			for (const x of evalNode(ast.e, v, env)) {
				const loopEnv = extendEnv(env, ast.p, x);
				acc = firstOf(evalNode(ast.u, acc, loopEnv));
			}
			yield acc;
			break;
		}

		case 'foreach': {
			let acc = firstOf(evalNode(ast.i, v, env));
			for (const x of evalNode(ast.e, v, env)) {
				const loopEnv = extendEnv(env, ast.p, x);
				acc = firstOf(evalNode(ast.u, acc, loopEnv));
				if (ast.ex) yield* evalNode(ast.ex, acc, loopEnv);
				else yield acc;
			}
			break;
		}

		case 'label': {
			try {
				yield* evalNode(ast.b, v, env);
			} catch (e) {
				if (e instanceof JqBreak && e.label === ast.n) break;
				throw e;
			}
			break;
		}

		case 'break': throw new JqBreak(ast.n);

		case 'path': {
			for (const p of evalPathExpr(ast.e, v, env, [])) yield p;
			break;
		}

		case 'getpath': {
			const p = firstOf(evalNode(ast.p, v, env)) as Path;
			yield getPath(v, p);
			break;
		}

		case 'setpath': {
			const p = firstOf(evalNode(ast.p, v, env)) as Path;
			const val = firstOf(evalNode(ast.v, v, env));
			yield setPath(v, p, val);
			break;
		}

		case 'delpaths': {
			const paths = firstOf(evalNode(ast.p, v, env)) as Path[];
			let result = v;
			const sorted = [...paths].sort((a, b) => b.length - a.length);
			for (const p of sorted) result = delPath(result, p);
			yield result;
			break;
		}

		case 'assign': {
			// .path = value — set every targeted path (RHS evaluated against the
			// original input), so multi-path LHS like `(.a, .b) = 0` set both.
			const val = firstOf(evalNode(ast.r, v, env));
			let result = v;
			for (const p of evalPathExpr(ast.l, v, env, [])) {
				result = setPath(result, p, val);
			}
			yield result;
			break;
		}

		case 'update': {
			// .path |= f — update value at path
			let result = v;
			for (const p of evalPathExpr(ast.l, v, env, [])) {
				const old = getPath(result, p);
				const upd = firstOf(evalNode(ast.r, old, env));
				result = setPath(result, p, upd);
			}
			yield result;
			break;
		}

		case 'updop': {
			// .path op= value
			let result = v;
			for (const p of evalPathExpr(ast.l, v, env, [])) {
				const old = getPath(result, p);
				const rhs = firstOf(evalNode(ast.r, v, env));
				let newVal: JV;
				switch (ast.op) {
					case '+': newVal = jqAdd(old, rhs); break;
					case '-': newVal = jqSub(old, rhs); break;
					case '*': newVal = jqMul(old, rhs); break;
					case '/': newVal = jqDiv(old, rhs); break;
					case '%': newVal = jqMod(old, rhs); break;
					case '//': newVal = (old !== null && old !== false) ? old : rhs; break;
					default: err(`unknown update op: ${ast.op}`);
				}
				result = setPath(result, p, newVal);
			}
			yield result;
			break;
		}

		case 'interp': {
			let s = '';
			for (const p of ast.ps) {
				if (typeof p === 'string') s += p;
				else s += String(firstOf(evalNode(p, v, env)) ?? 'null');
			}
			yield s;
			break;
		}

		case 'fmt': {
			if (ast.e === null) {
				yield applyFormat(ast.f, v);
			} else {
				// @format "template\(expr)"
				for (const x of evalNode(ast.e, v, env)) {
					if (typeof x === 'string') {
						// x is already the interpolated string — apply format
						yield applyFormat(ast.f, x);
					} else {
						yield applyFormat(ast.f, x);
					}
				}
			}
			break;
		}

		case 'def': {
			// Key user functions by `name/arity` too, so overloads and arity-correct
			// dispatch work the same as for builtins.
			const key = `${ast.n}/${ast.ps.length}`;
			const userFn: UserFn = { kind: 'user', params: ast.ps, body: ast.b, env };
			const newEnv = extendEnvFn(env, key, userFn);
			// Also update the closure to be self-referential (for recursion)
			userFn.env = newEnv;
			yield* evalNode(ast.rest, v, newEnv);
			break;
		}

		default: {
			const _: never = ast;
			err(`unknown AST node: ${(_  as { t: string }).t}`);
		}
	}
}
