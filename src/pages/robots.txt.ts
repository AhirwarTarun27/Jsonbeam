import type { APIRoute } from 'astro';

const body = (sitemap: string) => `User-agent: *
Allow: /

Sitemap: ${sitemap}
`;

export const GET: APIRoute = ({ site }) => {
	const sitemap = new URL('sitemap.xml', site).href;
	return new Response(body(sitemap), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
