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
			{ label: 'JSON Beautifier', href: '/json-beautifier', soon: true },
			{ label: 'JSON Minifier', href: '/json-minifier', soon: true },
			{ label: 'JSON Validator', href: '/json-validator', soon: true },
			{ label: 'JSON Repair', href: '/json-repair', soon: true },
		],
	},
	{
		title: 'View & explore',
		links: [
			{ label: 'JSON Viewer', href: '/json-viewer', soon: true },
			{ label: 'Tree Viewer', href: '/json-tree-viewer', soon: true },
			{ label: 'Graph Viewer', href: '/json-graph-viewer', soon: true },
			{ label: 'Table Viewer', href: '/json-table-viewer', soon: true },
			{ label: 'JSON Diff', href: '/json-diff', soon: true },
		],
	},
	{
		title: 'Query & convert',
		links: [
			{ label: 'JSON Query (jq / JSONPath)', href: '/json-query', soon: true },
			{ label: 'JSON → CSV', href: '/json-to-csv', soon: true },
			{ label: 'JSON → YAML', href: '/json-to-yaml', soon: true },
			{ label: 'JSON → TypeScript', href: '/json-to-typescript', soon: true },
			{ label: 'JSON → Go', href: '/json-to-go', soon: true },
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
