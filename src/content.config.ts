import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { AUTHOR_NAME } from './consts';

/**
 * `guides` — the JSON Beam knowledge base. Long-form, original articles that
 * make the site a genuine JSON *resource* (not just a set of tools), which is
 * what both AdSense's content-quality bar and search ranking reward.
 *
 * Markdown lives in src/content/guides/*.md; each file's name becomes its slug
 * (→ /blog/<slug>). Frontmatter is validated by the schema below.
 */
const guides = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
	schema: z.object({
		/** Article headline (also the <h1> and <title> seed). */
		title: z.string(),
		/** Meta description (≤155 chars) + hero sub-paragraph. */
		description: z.string(),
		publishDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		author: z.string().default(AUTHOR_NAME),
		/** Topic tags (shown as eyebrow chips, used for grouping). */
		tags: z.array(z.string()).default([]),
		/** Tool CTAs shown at the foot of the article. */
		relatedTools: z
			.array(z.object({ name: z.string(), href: z.string(), desc: z.string() }))
			.default([]),
		/** Optional social image; falls back to the site default. */
		image: z.string().optional(),
		draft: z.boolean().default(false),
	}),
});

export const collections = { guides };
