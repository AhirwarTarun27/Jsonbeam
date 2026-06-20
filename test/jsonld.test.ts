import { describe, it, expect } from 'vitest';
import { webSite, softwareApplication, faqPage, breadcrumbs } from '../src/lib/jsonld';

describe('webSite', () => {
	it('is a WebSite with a SearchAction', () => {
		const data = webSite();
		expect(data['@type']).toBe('WebSite');
		const action = data.potentialAction as Record<string, unknown>;
		expect(action['@type']).toBe('SearchAction');
		expect(action['query-input']).toContain('search_term_string');
	});
});

describe('softwareApplication', () => {
	it('declares a free, browser-based developer app', () => {
		const data = softwareApplication({
			name: 'JSON Beam — JSON Formatter',
			description: 'Format JSON',
			url: 'https://jsonbeam.com/json-formatter',
		});
		expect(data['@type']).toBe('SoftwareApplication');
		expect(data.applicationCategory).toBe('DeveloperApplication');
		expect(data.isAccessibleForFree).toBe(true);
		expect((data.offers as Record<string, unknown>).price).toBe('0');
	});
});

describe('faqPage', () => {
	it('maps each item to a Question/Answer pair', () => {
		const items = [
			{ question: 'Q1?', answer: 'A1.' },
			{ question: 'Q2?', answer: 'A2.' },
		];
		const data = faqPage(items);
		expect(data['@type']).toBe('FAQPage');
		const entities = data.mainEntity as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(2);
		expect(entities[0]['@type']).toBe('Question');
		expect(entities[0].name).toBe('Q1?');
		expect((entities[0].acceptedAnswer as Record<string, unknown>).text).toBe('A1.');
	});
});

describe('breadcrumbs', () => {
	it('numbers list items from position 1', () => {
		const data = breadcrumbs([
			{ name: 'Home', url: 'https://jsonbeam.com' },
			{ name: 'JSON Formatter', url: 'https://jsonbeam.com/json-formatter' },
		]);
		expect(data['@type']).toBe('BreadcrumbList');
		const items = data.itemListElement as Array<Record<string, unknown>>;
		expect(items.map((i) => i.position)).toEqual([1, 2]);
		expect(items[1].name).toBe('JSON Formatter');
	});
});
