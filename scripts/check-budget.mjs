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

/** Routes allowed to ship app JS, mapped to their gzipped initial-JS budget. */
const ISLAND_BUDGETS = {
	'json-formatter': 120 * KB,
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
console.log('\n✓ Bundle budget check passed.');
