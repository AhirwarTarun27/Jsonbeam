/** Site-wide constants. Single source of truth for brand + SEO defaults. */

export const SITE_URL = 'https://jsonbeam.com';
export const SITE_NAME = 'JSON Beam';
export const SITE_TAGLINE = 'The professional JSON workbench';

export const SITE_DESCRIPTION =
	'Format, validate, repair, and convert JSON in your browser. 100% client-side, private, and fast enough for huge files. Free, no account, no upload.';

/** Default Open Graph image (static for Phase 1; per-page dynamic OG is Phase 2). */
export const DEFAULT_OG_IMAGE = '/og-default.svg';

/** Brand promises — reused across hero, footer, and structured data. */
export const BRAND_PROMISES = [
	'Private by design — 100% client-side, nothing uploaded.',
	'No ceiling — handles huge files without freezing the tab.',
	'Instant — sub-second load, usable before the page finishes painting.',
	'Free forever — no ads, no signup, no dark patterns.',
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
			{ label: 'Blog', href: '/blog', soon: true },
			{ label: 'Privacy', href: '/privacy', soon: true },
			{ label: 'Open source', href: '/open-source', soon: true },
			{ label: 'Changelog', href: '/changelog', soon: true },
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

export const TOOL_NAV: ToolTabGroup[] = [
	{
		title: 'Format',
		items: [
			{ label: 'Format', href: '/json-formatter' },
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
