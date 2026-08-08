/**
 * Performance-budget guard. Run AFTER `astro build`.
 *
 * Enforces the two hard contracts from CLAUDE.md:
 *   1. Content/marketing routes ship 0 KB of app JS.
 *   2. Island routes stay under their gzipped initial-JS budget.
 *
 * "Initial JS" = every <script type="module" src> plus every
 * <link rel="modulepreload"> the page declares (entry + statically-imported
 * chunks). Dynamic imports (e.g. jsonrepair) are not preloaded, so they're
 * correctly excluded.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
const KB = 1024;

/**
 * Routes allowed to ship app JS, mapped to their gzipped initial-JS budget.
 * Two tiers:
 *   • The formatter family shares the CodeMirror editor island → 120 KB.
 *   • Every other tool is a lean, framework-free island that lazy-loads its
 *     engine on demand → a tight 40 KB ceiling (actuals sit at ~3–9 KB).
 * Every island route MUST appear here; any unlisted route is held to 0 KB.
 */
const EDITOR = 120 * KB;
const LEAN = 40 * KB;
// Warn (without failing) once a route crosses this fraction of its budget, so a
// route creeping toward its cap — e.g. the formatter family at ~115/120 KB — is
// visible in CI long before a CodeMirror bump or new feature breaches the hard limit.
const WARN_RATIO = 0.92;
const ISLAND_BUDGETS = {
	'json-formatter': EDITOR,
	'json-beautifier': EDITOR,
	'json-minifier': EDITOR,
	'json-validator': EDITOR,
	'json-repair': EDITOR,
	'json-viewer': LEAN,
	'json-tree-viewer': LEAN,
	'json-visualizer': LEAN, // hosts the graph-viewer island
	'json-table-viewer': LEAN,
	'json-diff': LEAN,
	'json-query': LEAN,
	'json-to-csv': LEAN,
	'json-to-yaml': LEAN,
	'json-to-typescript': LEAN,
	'json-to-go': LEAN,
};

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

/** dist/index.html → '' · dist/json-formatter/index.html → 'json-formatter' */
function routeOf(htmlPath) {
	return relative(DIST, htmlPath)
		.split(sep)
		.join('/')
		.replace(/\/?index\.html$/, '')
		.replace(/\.html$/, '');
}

/** Collect JS the page loads on first paint: module scripts + modulepreloads. */
function initialJsAssets(html) {
	const assets = new Set();

	for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
		const attrs = m[1];
		if (/type="module"/.test(attrs)) {
			const src = attrs.match(/src="([^"]+)"/);
			if (src) assets.add(src[1]);
		}
	}
	for (const m of html.matchAll(/<link\b([^>]*)>/g)) {
		const attrs = m[1];
		if (/rel="modulepreload"/.test(attrs)) {
			const href = attrs.match(/href="([^"]+)"/);
			if (href) assets.add(href[1]);
		}
	}
	return [...assets].filter((a) => a.endsWith('.js'));
}

function gzSize(urlPath) {
	return gzipSync(readFileSync(join(DIST, urlPath.replace(/^\//, '')))).length;
}

let failed = false;
let warned = false;
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));

for (const file of htmlFiles) {
	const route = routeOf(file);
	const assets = initialJsAssets(readFileSync(file, 'utf8'));
	const total = assets.reduce((sum, a) => sum + gzSize(a), 0);
	const budget = ISLAND_BUDGETS[route];
	const name = `/${route}`;

	if (budget === undefined) {
		if (assets.length > 0) {
			failed = true;
			console.error(
				`✗ ${name} — content route ships ${assets.length} app-JS file(s), ${(total / KB).toFixed(1)} KB gz (must be 0).`
			);
		} else {
			console.log(`✓ ${name} — 0 KB app JS`);
		}
	} else if (total > budget) {
		failed = true;
		console.error(
			`✗ ${name} — initial JS ${(total / KB).toFixed(1)} KB gz exceeds ${(budget / KB).toFixed(0)} KB budget.`
		);
	} else if (total >= budget * WARN_RATIO) {
		warned = true;
		console.warn(
			`⚠ ${name} — initial JS ${(total / KB).toFixed(1)} KB gz is ${((total / budget) * 100).toFixed(0)}% of its ${(budget / KB).toFixed(0)} KB budget (warn ≥ ${(WARN_RATIO * 100).toFixed(0)}%). Headroom is tight — trim before adding more.`
		);
	} else {
		console.log(
			`✓ ${name} — initial JS ${(total / KB).toFixed(1)} KB gz (budget ${(budget / KB).toFixed(0)} KB)`
		);
	}
}

if (failed) {
	console.error('\n✗ Bundle budget check FAILED.');
	process.exit(1);
}
console.log(
	warned
		? '\n✓ Bundle budget check passed — but one or more routes are near their cap (see ⚠ above).'
		: '\n✓ Bundle budget check passed.'
);
