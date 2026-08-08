import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
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
// the indexable assets, legal/company pages change rarely. Takes either form of
// the path (with or without the trailing slash) so it can be called before or
// after normalisation without the /blog vs /blog/ cases crossing wires.
function meta(rawPath: string): { changefreq: string; priority: string } {
	const path = rawPath !== '/' && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
	if (path === '/') return { changefreq: 'weekly', priority: '1.0' };
	if (path === '/blog') return { changefreq: 'weekly', priority: '0.7' };
	if (path.startsWith('/blog/')) return { changefreq: 'monthly', priority: '0.7' };
	if (/^\/(about|contact|privacy|cookie-policy|terms|disclaimer)\b/.test(path))
		return { changefreq: 'yearly', priority: '0.5' };
	return { changefreq: 'monthly', priority: '0.8' };
}

/**
 * The static build uses Astro's default `build.format: 'directory'`, so every
 * route below the homepage is served at a trailing-slash URL (/json-formatter/),
 * and the canonical tag BaseHead derives from `Astro.url.pathname` carries that
 * slash too. Sitemap <loc>, the canonical tag, and the URL that actually returns
 * 200 must be byte-identical — otherwise Google files the sitemap URL as a
 * redirect and indexes the other variant, splitting every page's signals.
 * FOOTER_NAV stores slash-less hrefs, so normalise on the way out.
 */
const withSlash = (path: string) => (path === '/' || path.endsWith('/') ? path : `${path}/`);

// Sitemap <loc> values must XML-escape ampersands; our slugs are clean today,
// but this keeps a future slug with a query/`&` from emitting invalid XML.
const escapeLoc = (loc: string) => loc.replace(/&/g, '&amp;');

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL('https://jsonbeam.com');

	// Every published guide → /blog/<slug>, carrying its own real edit date.
	const guideRoutes = (await getCollection('guides'))
		.filter((entry) => !entry.data.draft)
		.map((entry) => ({
			path: `/blog/${entry.id}`,
			lastmod: (entry.data.updatedDate ?? entry.data.publishDate).toISOString().slice(0, 10),
		}));

	// Homepage + every live (non-`soon`) FOOTER_NAV destination + guides.
	// Static routes deliberately carry no <lastmod>: stamping today's date on all
	// of them every build is a claim we can't back, and a sitemap that always says
	// "everything changed just now" gets its dates discounted wholesale.
	const routes: { path: string; lastmod?: string }[] = [
		{ path: '/' },
		...FOOTER_NAV.flatMap((col) => col.links)
			.filter((link) => !link.soon)
			.map((link) => ({ path: link.href })),
		...guideRoutes,
	];

	// Normalise to the served (trailing-slash) URL, then de-duplicate on it.
	const byPath = new Map<string, { path: string; lastmod?: string }>();
	for (const route of routes) {
		const path = withSlash(route.path);
		if (!byPath.has(path)) byPath.set(path, { ...route, path });
	}

	const urls = [...byPath.values()]
		.map((route) => {
			const { changefreq, priority } = meta(route.path);
			const loc = escapeLoc(new URL(route.path, base).href);
			const lastmod = route.lastmod ? `\n    <lastmod>${route.lastmod}</lastmod>` : '';
			return `  <url>
    <loc>${loc}</loc>${lastmod}
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
