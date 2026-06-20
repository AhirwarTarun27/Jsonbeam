// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://jsonbeam.com',
	output: 'static',
	integrations: [sitemap()],
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
