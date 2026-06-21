// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://jsonbeam.com',
	output: 'static',
	integrations: [
		sitemap({
			// Keep noindex utility pages (the contact thank-you screen) and the
			// error routes out of the sitemap so it never advertises a URL we ask
			// crawlers to skip.
			filter: (page) =>
				!page.includes('/contact/thanks') &&
				!page.includes('/404') &&
				!page.includes('/500'),
		}),
	],
	vite: {
		plugins: [tailwindcss()],
		optimizeDeps: {
			// Pre-bundle these at server start so they don't trigger re-optimisation
			// (and the resulting full-page reload) the first time a query is run.
			// jmespath is CJS-only; jsonpath-plus has a browser ESM build but Vite
			// still needs to discover it up front to avoid the "outdated dep" reload.
			include: ['jsonpath-plus', 'jmespath'],
		},
	},
});
