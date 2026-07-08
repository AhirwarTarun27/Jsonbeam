/** Site-wide constants. Single source of truth for brand + SEO defaults. */

export const SITE_URL = 'https://jsonbeam.com';
export const SITE_NAME = 'JSON Beam';
export const SITE_TAGLINE = 'The professional JSON workbench';

export const SITE_DESCRIPTION =
	'Format, validate, repair, and convert JSON in your browser. 100% client-side, private, and fast enough for huge files. Free, no account, no upload.';

/**
 * Default Open Graph image — a 1200×630 PNG (raster, because social platforms
 * do not render SVG OG images). Per-page dynamic OG is Phase 2.
 */
export const DEFAULT_OG_IMAGE = '/og-default.png';
export const DEFAULT_OG_IMAGE_ALT =
	'JSON Beam — the fast, private, in-browser JSON formatter, validator, and viewer.';

/**
 * Publisher + author identity for structured data (E-E-A-T signals). `AUTHOR_NAME`
 * is the byline on guides — change it to a real person's name to strengthen
 * authorship signals. `SITE_LOGO` is the Organization logo used in JSON-LD.
 */
export const SITE_LOGO = '/favicon.svg';
export const AUTHOR_NAME = 'Tarun Ahirwar';

/** Brand promises — reused across hero, footer, and structured data. */
export const BRAND_PROMISES = [
	'Private by design — 100% client-side, nothing uploaded.',
	'No ceiling — handles huge files without freezing the tab.',
	'Instant — sub-second load, usable before the page finishes painting.',
	'Free forever — no signup, no upload, no limits.',
] as const;

/**
 * Variants of the shared formatter island. Drives which toolbar button is the
 * primary (ink) action, what Ctrl+S runs, and the default document. One island,
 * one JS chunk — the variant only re-skins behavior, never re-bundles.
 */
export type ToolVariant = 'format' | 'beautify' | 'minify' | 'validate' | 'repair';

/** Footer mega-nav model — every tool is an indexable landing page. */
export interface NavLink {
	label: string;
	href: string;
	/** Pages not yet shipped render as muted, non-linked "coming soon" rows. */
	soon?: boolean;
}
export interface NavColumn {
	title: string;
	links: NavLink[];
}

export const FOOTER_NAV: NavColumn[] = [
	{
		title: 'Format & validate',
		links: [
			{ label: 'JSON Formatter', href: '/json-formatter' },
			{ label: 'JSON Editor', href: '/json-editor' },
			{ label: 'JSON Beautifier', href: '/json-beautifier' },
			{ label: 'JSON Minifier', href: '/json-minifier' },
			{ label: 'JSON Validator', href: '/json-validator' },
			{ label: 'JSON Repair', href: '/json-repair' },
		],
	},
	{
		title: 'View & explore',
		links: [
			{ label: 'JSON Viewer', href: '/json-viewer' },
			{ label: 'JSON Visualizer', href: '/json-visualizer' },
			{ label: 'Tree Viewer', href: '/json-tree-viewer' },
			{ label: 'Graph Viewer', href: '/json-graph-viewer' },
			{ label: 'Table Viewer', href: '/json-table-viewer' },
			{ label: 'JSON Diff', href: '/json-diff' },
		],
	},
	{
		title: 'Query & convert',
		links: [
			{ label: 'JSON Query (jq / JSONPath)', href: '/json-query' },
			{ label: 'JSON → CSV', href: '/json-to-csv' },
			{ label: 'JSON → YAML', href: '/json-to-yaml' },
			{ label: 'JSON → TypeScript', href: '/json-to-typescript' },
			{ label: 'JSON → Go', href: '/json-to-go' },
		],
	},
	{
		title: 'Project',
		links: [
			{ label: 'Editor', href: '/editor', soon: true },
			{ label: 'Open source', href: '/open-source', soon: true },
			{ label: 'Changelog', href: '/changelog', soon: true },
		],
	},
	{
		title: 'Company',
		links: [
			{ label: 'About', href: '/about' },
			{ label: 'Contact', href: '/contact' },
			{ label: 'Guides', href: '/blog' },
			{ label: 'Privacy Policy', href: '/privacy' },
			{ label: 'Cookie Policy', href: '/cookie-policy' },
			{ label: 'Terms & Conditions', href: '/terms' },
			{ label: 'Disclaimer', href: '/disclaimer' },
		],
	},
];

/**
 * In-app tool switcher surface. A compact, grouped rail rendered above every
 * tool island (see `ToolSwitcher.astro`) so any tool is one click away from
 * inside any tool page — discoverability without scroll-hunting the footer.
 * Mirrors FOOTER_NAV's tool entries, but with short, rail-friendly labels.
 */
export interface ToolTab {
	/** Short rail label, e.g. "Validate". */
	label: string;
	href: string;
	soon?: boolean;
}
export interface ToolTabGroup {
	/** Job-based cluster: Format · View · Query · Convert. */
	title: string;
	items: ToolTab[];
}

/**
 * Tool → guide map. Lets each tool landing page auto-link the guide that
 * teaches its topic (rendered by `ToolPage.astro`), so every tool is one hop
 * from long-form content and every guide is reachable from a tool. Bidirectional
 * internal linking is a core ranking + discoverability signal.
 */
export const TOOL_GUIDES: Record<string, { href: string; label: string }> = {
	'/json-formatter': { href: '/blog/json-formatting-best-practices', label: 'JSON formatting & minification: best practices' },
	'/json-beautifier': { href: '/blog/json-formatting-best-practices', label: 'JSON formatting & minification: best practices' },
	'/json-minifier': { href: '/blog/json-formatting-best-practices', label: 'JSON formatting & minification: best practices' },
	'/json-editor': { href: '/blog/what-is-json', label: 'What is JSON? A practical guide' },
	'/json-validator': { href: '/blog/how-to-validate-json', label: 'How to validate JSON and read the error messages' },
	'/json-repair': { href: '/blog/common-json-errors', label: 'Common JSON errors and how to fix them' },
	'/json-viewer': { href: '/blog/what-is-json', label: 'What is JSON? A practical guide' },
	'/json-tree-viewer': { href: '/blog/what-is-json', label: 'What is JSON? A practical guide' },
	'/json-visualizer': { href: '/blog/what-is-json', label: 'What is JSON? A practical guide' },
	'/json-graph-viewer': { href: '/blog/json-syntax-rules', label: 'JSON syntax rules, explained with examples' },
	'/json-table-viewer': { href: '/blog/convert-json-to-csv', label: 'How to convert JSON to CSV' },
	'/json-diff': { href: '/blog/how-to-compare-json-files', label: 'How to compare two JSON files' },
	'/json-query': { href: '/blog/jsonpath-vs-jq-vs-jmespath', label: 'JSONPath vs jq vs JMESPath: which query language?' },
	'/json-to-csv': { href: '/blog/convert-json-to-csv', label: 'How to convert JSON to CSV' },
	'/json-to-yaml': { href: '/blog/json-vs-yaml', label: 'JSON vs YAML: differences and when to use each' },
	'/json-to-typescript': { href: '/blog/json-to-typescript-types', label: 'Generating TypeScript types from JSON' },
	'/json-to-go': { href: '/blog/json-to-typescript-types', label: 'Generating TypeScript types from JSON' },
};

export const TOOL_NAV: ToolTabGroup[] = [
	{
		title: 'Format',
		items: [
			{ label: 'Format', href: '/json-formatter' },
			{ label: 'Editor', href: '/json-editor' },
			{ label: 'Beautify', href: '/json-beautifier' },
			{ label: 'Minify', href: '/json-minifier' },
			{ label: 'Validate', href: '/json-validator' },
			{ label: 'Repair', href: '/json-repair' },
		],
	},
	{
		title: 'View',
		items: [
			{ label: 'Viewer', href: '/json-viewer' },
			{ label: 'Visualizer', href: '/json-visualizer' },
			{ label: 'Tree', href: '/json-tree-viewer' },
			{ label: 'Graph', href: '/json-graph-viewer' },
			{ label: 'Table', href: '/json-table-viewer' },
			{ label: 'Diff', href: '/json-diff' },
		],
	},
	{
		title: 'Query',
		items: [{ label: 'jq / JSONPath', href: '/json-query' }],
	},
	{
		title: 'Convert',
		items: [
			{ label: 'CSV', href: '/json-to-csv' },
			{ label: 'YAML', href: '/json-to-yaml' },
			{ label: 'TypeScript', href: '/json-to-typescript' },
			{ label: 'Go', href: '/json-to-go' },
		],
	},
];
