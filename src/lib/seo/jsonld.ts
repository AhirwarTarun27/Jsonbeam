/**
 * JSON-LD structured-data builders. We are a JSON tool — our structured data
 * should be exemplary. Each builder returns a plain object serialised into a
 * <script type="application/ld+json"> tag by BaseHead.
 */
import { SITE_NAME, SITE_URL, SITE_LOGO, AUTHOR_NAME } from '../../consts';

type Json = Record<string, unknown>;

export interface FaqItem {
	question: string;
	answer: string;
}

/** Publisher node, reused as the `publisher` of articles and as a standalone
 * Organization on the homepage. `@context` is added only by `organization()`. */
function orgNode(): Json {
	return {
		'@type': 'Organization',
		name: SITE_NAME,
		url: SITE_URL,
		logo: { '@type': 'ImageObject', url: new URL(SITE_LOGO, SITE_URL).href },
	};
}

/** WebSite + SearchAction — home page only. */
export function webSite(): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		url: SITE_URL,
		potentialAction: {
			'@type': 'SearchAction',
			target: {
				'@type': 'EntryPoint',
				urlTemplate: `${SITE_URL}/json-formatter?q={search_term_string}`,
			},
			'query-input': 'required name=search_term_string',
		},
	};
}

/** SoftwareApplication — the tool itself. Free, browser-based, no install. */
export function softwareApplication(opts: {
	name: string;
	description: string;
	url: string;
}): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: opts.name,
		description: opts.description,
		url: opts.url,
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Any (web browser)',
		browserRequirements: 'Requires JavaScript. Runs entirely in the browser.',
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
		isAccessibleForFree: true,
	};
}

/**
 * Generic content page — privacy, terms, about, contact. `type` narrows the
 * schema.org class (AboutPage / ContactPage) where a specific one exists.
 */
export function webPage(opts: {
	type?: 'WebPage' | 'AboutPage' | 'ContactPage';
	name: string;
	description: string;
	url: string;
}): Json {
	return {
		'@context': 'https://schema.org',
		'@type': opts.type ?? 'WebPage',
		name: opts.name,
		description: opts.description,
		url: opts.url,
		isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
	};
}

/** FAQPage — mirrors the visible FAQ on the page. */
export function faqPage(items: FaqItem[]): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: items.map((item) => ({
			'@type': 'Question',
			name: item.question,
			acceptedAnswer: { '@type': 'Answer', text: item.answer },
		})),
	};
}

/** BreadcrumbList — Home › Page. */
export function breadcrumbs(trail: { name: string; url: string }[]): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: trail.map((crumb, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: crumb.name,
			item: crumb.url,
		})),
	};
}

/** Organization — the publisher. Emitted site-wide (homepage) for E-E-A-T. */
export function organization(): Json {
	return {
		'@context': 'https://schema.org',
		...orgNode(),
		description: SITE_NAME + ' — a fast, private, in-browser JSON workbench.',
	};
}

/** Person — an article author. */
export function person(opts: { name: string; url?: string }): Json {
	return {
		'@type': 'Person',
		name: opts.name,
		...(opts.url ? { url: opts.url } : {}),
	};
}

/**
 * BlogPosting — a guide/article. Carries author (Person) + publisher
 * (Organization) so articles are eligible for rich results and read as a real
 * publication, not a bare tool.
 */
export function article(opts: {
	headline: string;
	description: string;
	url: string;
	datePublished: string;
	dateModified?: string;
	authorName?: string;
	image?: string;
	section?: string;
}): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'BlogPosting',
		headline: opts.headline,
		description: opts.description,
		url: opts.url,
		mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
		datePublished: opts.datePublished,
		dateModified: opts.dateModified ?? opts.datePublished,
		author: person({ name: opts.authorName ?? AUTHOR_NAME, url: SITE_URL }),
		publisher: orgNode(),
		...(opts.image ? { image: [new URL(opts.image, SITE_URL).href] } : {}),
		...(opts.section ? { articleSection: opts.section } : {}),
		isAccessibleForFree: true,
	};
}

/** HowTo — built from a tool page's existing numbered steps. */
export function howTo(opts: {
	name: string;
	description?: string;
	steps: { title: string; body: string }[];
	url?: string;
}): Json {
	return {
		'@context': 'https://schema.org',
		'@type': 'HowTo',
		name: opts.name,
		...(opts.description ? { description: opts.description } : {}),
		...(opts.url ? { url: opts.url } : {}),
		step: opts.steps.map((s, i) => ({
			'@type': 'HowToStep',
			position: i + 1,
			name: s.title,
			text: s.body,
		})),
	};
}
