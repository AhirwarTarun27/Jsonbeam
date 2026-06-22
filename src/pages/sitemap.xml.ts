import type { APIRoute } from 'astro';
import { FOOTER_NAV } from '../consts';

/**
 * Data-driven sitemap, served at the conventional /sitemap.xml.
 *
 * The URL list is derived from FOOTER_NAV (the canonical tool surface) plus the
 * homepage — so a page joins the sitemap automatically the moment its `soon`
 * flag is dropped, with no hand-kept list to drift. Unbuilt (`soon`) routes and
 * the noindex utility/error routes (/contact/thanks, /404, /500) are excluded
 * by construction: they're never in FOOTER_NAV as live links.
 *
 * Prerendered to dist/sitemap.xml by the static build (like robots.txt.ts).
 */

// changefreq + priority hints by route shape: the homepage leads, the tools are
// the indexable assets, legal/company pages change rarely.
function meta(path: string): { changefreq: string; priority: string } {
	if (path === '/') return { changefreq: 'weekly', priority: '1.0' };
	if (/^\/(about|contact|privacy|terms)\b/.test(path))
		return { changefreq: 'yearly', priority: '0.5' };
	return { changefreq: 'monthly', priority: '0.8' };
}

// Sitemap <loc> values must XML-escape ampersands; our slugs are clean today,
// but this keeps a future slug with a query/`&` from emitting invalid XML.
const escapeLoc = (loc: string) => loc.replace(/&/g, '&amp;');

export const GET: APIRoute = ({ site }) => {
	const base = site ?? new URL('https://jsonbeam.com');
	const lastmod = new Date().toISOString().slice(0, 10);

	// Homepage + every live (non-`soon`) FOOTER_NAV destination, de-duplicated.
	const paths = [
		'/',
		...FOOTER_NAV.flatMap((col) => col.links)
			.filter((link) => !link.soon)
			.map((link) => link.href),
	];

	const urls = [...new Set(paths)]
		.map((path) => {
			const { changefreq, priority } = meta(path);
			const loc = escapeLoc(new URL(path, base).href);
			return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
		})
		.join('\n');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
