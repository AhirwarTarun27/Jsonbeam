/**
 * JSON-LD structured-data builders. We are a JSON tool — our structured data
 * should be exemplary. Each builder returns a plain object serialised into a
 * <script type="application/ld+json"> tag by BaseHead.
 */
import { SITE_NAME, SITE_URL } from '../consts';

type Json = Record<string, unknown>;

export interface FaqItem {
	question: string;
	answer: string;
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
