/**
 * Semantic-token guard.
 *
 * The workbench token layer (`src/styles/tokens/semantic.css`) is shipped to
 * every tool route, so a token nobody references is pure weight — and a token
 * referenced but never declared is a silent rendering bug (an undefined
 * `var()` makes the whole declaration invalid, so the element falls back to
 * transparent/inherited rather than erroring anywhere visible).
 *
 * This checks both directions:
 *   1. Every token declared in `:root` is referenced somewhere in src/.
 *   2. Every `--surface-*` / `--syntax-*` / `--diff-*` / `--graph-*` reference
 *      in src/ resolves to a token that semantic.css actually declares.
 *   3. The dark (`:root`) and light (`html.jb-theme-light`) blocks declare the
 *      SAME set of names — a token missing from one side silently keeps the
 *      other theme's value, which is exactly the drift this layer exists to
 *      prevent.
 *
 * Run via `npm run check:tokens` (wired into `npm run ci`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SEMANTIC = 'src/styles/tokens/semantic.css';
const PREFIXES = ['--surface-', '--syntax-', '--diff-', '--graph-'];

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(astro|css|ts)$/.test(p)) out.push(p);
	}
	return out;
}

const semantic = readFileSync(SEMANTIC, 'utf8');

/** Token names declared inside a given selector block. */
function declared(selector) {
	const start = semantic.indexOf(selector);
	if (start < 0) throw new Error(`${SEMANTIC}: missing "${selector}" block`);
	const open = semantic.indexOf('{', start);
	let depth = 0;
	let end = open;
	for (let i = open; i < semantic.length; i++) {
		if (semantic[i] === '{') depth++;
		else if (semantic[i] === '}' && --depth === 0) {
			end = i;
			break;
		}
	}
	const body = semantic.slice(open, end);
	return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

const dark = declared(':root');
const light = declared('html.jb-theme-light');

// Everything in src/ except the declaration file itself.
const sources = walk('src')
	.filter((p) => relative('.', p).split(sep).join('/') !== SEMANTIC)
	.map((p) => readFileSync(p, 'utf8'))
	.join('\n');

const referenced = new Set(
	[...sources.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1])
		// The graph island resolves tokens by name at runtime: resolve('--graph-bg')
		.concat([...sources.matchAll(/resolve\(\s*['"](--[a-z0-9-]+)['"]/g)].map((m) => m[1]))
);

let failed = false;
const fail = (msg) => {
	failed = true;
	console.error(`✗ ${msg}`);
};

// 1. Declared but unused.
for (const name of [...dark].sort()) {
	if (!referenced.has(name)) fail(`${name} is declared in semantic.css but never referenced — remove it.`);
}

// 2. Referenced but undeclared.
for (const name of [...referenced].sort()) {
	if (PREFIXES.some((p) => name.startsWith(p)) && !dark.has(name)) {
		fail(`${name} is used in src/ but not declared in semantic.css — the declaration using it is dead.`);
	}
}

// 3. Dark and light must agree on the token SET.
for (const name of [...dark].sort()) {
	if (!light.has(name)) fail(`${name} is missing from the html.jb-theme-light block — light mode silently inherits the dark value.`);
}
for (const name of [...light].sort()) {
	if (!dark.has(name)) fail(`${name} is declared only for light mode — dark mode has no value for it.`);
}

if (failed) {
	console.error('\n✗ Token check FAILED.');
	process.exit(1);
}
console.log(`✓ Token check passed — ${dark.size} semantic tokens, all referenced and defined in both themes.`);
