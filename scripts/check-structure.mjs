/**
 * Component-layout guard.
 *
 * `src/components/` is split by ONE question: does this component ship
 * JavaScript to the browser?
 *
 *   islands/  — yes. Every file here has a client <script>. These are the only
 *               components a route may pay JS for, and each one is measured by
 *               check-budget.mjs.
 *   layout/   — no. Page shells, <head>, nav, footer. The 0-KB contract for
 *               marketing/content routes lives or dies here.
 *   ui/       — no. Presentational atoms, reusable anywhere.
 *
 * That boundary is the codebase's most load-bearing invariant (CLAUDE.md
 * contract 1), and until now nothing in the file layout expressed it —
 * `Button.astro` and a 1,600-line canvas renderer sat side by side. A folder
 * split only helps if it cannot silently rot, so this script fails the build
 * when a component lands on the wrong side of the line.
 *
 * The one sanctioned exception is `is:inline` (CLAUDE.md contract 1): analytics
 * / AdSense / Consent Mode tags and JSON-LD data blocks. Astro ships those
 * verbatim and never bundles them, so they are not app JS. They are allowed in
 * `layout/` because that is precisely where BaseHead lives.
 *
 * Run via `npm run check:structure` (wired into `npm run ci`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/components';
const ZERO_JS = ['layout', 'ui'];

/** A <script> tag that Astro will bundle — i.e. not `is:inline`. */
const BUNDLED_SCRIPT = /<script(?![^>]*\bis:inline\b)[^>]*>/;

/**
 * The template half of a `.astro` file.
 *
 * Frontmatter runs at build time and never reaches the browser, so a `<script>`
 * *mentioned* there — in a doc comment, or a string — is not a shipped script.
 * BaseHead has exactly that in a comment describing its JSON-LD output.
 */
function template(file) {
	const src = readFileSync(file, 'utf8');
	if (!src.startsWith('---')) return src;
	const end = src.indexOf('\n---', 3);
	return end < 0 ? src : src.slice(end + 4);
}

function astroFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...astroFiles(p));
		else if (p.endsWith('.astro')) out.push(p);
	}
	return out;
}

let failed = false;
const fail = (msg) => {
	failed = true;
	console.error(`✗ ${msg}`);
};

// Nothing may sit loose at the top level — every component picks a side.
for (const name of readdirSync(ROOT)) {
	if (statSync(join(ROOT, name)).isFile()) {
		fail(`${ROOT}/${name} is not in islands/, layout/ or ui/ — every component must declare which side of the JS boundary it is on.`);
	}
}

let islands = 0;
let zeroJs = 0;

for (const file of astroFiles(join(ROOT, 'islands'))) {
	islands++;
	if (!BUNDLED_SCRIPT.test(template(file))) {
		fail(`${file} is in islands/ but ships no client <script>. If it is presentational, move it to ui/ or layout/ so routes are not charged for an island that isn't one.`);
	}
}

for (const dir of ZERO_JS) {
	for (const file of astroFiles(join(ROOT, dir))) {
		zeroJs++;
		if (BUNDLED_SCRIPT.test(template(file))) {
			fail(`${file} has a bundled <script>, but ${dir}/ is a zero-JS folder. Move it to islands/, or make the tag is:inline if it is a sanctioned third-party/JSON-LD tag.`);
		}
	}
}

if (failed) {
	console.error('\n✗ Structure check FAILED.');
	process.exit(1);
}
console.log(`✓ Structure check passed — ${islands} islands ship JS, ${zeroJs} layout/ui components ship none.`);
