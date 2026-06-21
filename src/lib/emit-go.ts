/**
 * Schema → Go struct generator. Lazy-loaded by the JsonConverter island.
 *
 * Consumes the merged `Schema` from `infer.ts`, so optional/nullable/union
 * inference is inherited, then renders idiomatic Go:
 *   • Exported, initialism-correct field names (userId → UserID, api_url → APIURL).
 *   • `json:"…"` struct tags, with optional `,omitempty`.
 *   • Pointers for nullable / optional fields (so absent ≠ zero).
 *   • `int` vs `int64` choice, `float64` for fractional numbers.
 *   • `time.Time` for ISO-8601 strings (with the matching import), opt-in.
 *   • Named nested structs (de-duplicated) or fully inline structs.
 *   • gofmt-style column alignment inside each struct.
 */

import {
	isOptionalField,
	type ArrayShape,
	type ObjectShape,
	type PrimShape,
	type Schema,
	type Shape,
} from './infer';

export interface GoOptions {
	rootName: string;
	jsonTags: boolean;
	omitempty: boolean;
	pointersForNullable: boolean;
	inlineStructs: boolean;
	intType: 'int' | 'int64';
	detectTime: boolean;
	/** `any` (Go 1.18+) vs the classic `interface{}`. */
	useAny: boolean;
}

export const DEFAULT_GO_OPTIONS: GoOptions = {
	rootName: 'Root',
	jsonTags: true,
	omitempty: false,
	pointersForNullable: true,
	inlineStructs: false,
	intType: 'int',
	detectTime: true,
	useAny: false,
};

/** Initialisms Go style guides expect fully upper-cased. */
const INITIALISMS = new Set([
	'ACL', 'API', 'ASCII', 'CPU', 'CSS', 'DNS', 'EOF', 'GUID', 'HTML', 'HTTP',
	'HTTPS', 'ID', 'IP', 'JSON', 'LHS', 'QPS', 'RAM', 'RHS', 'RPC', 'SLA',
	'SMTP', 'SQL', 'SSH', 'TCP', 'TLS', 'TTL', 'UDP', 'UI', 'UID', 'UUID',
	'URI', 'URL', 'UTF8', 'VM', 'XML', 'XMPP', 'XSRF', 'XSS',
]);

function splitWords(raw: string): string[] {
	return raw
		.replace(/[^A-Za-z0-9]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

/** Exported Go identifier from a JSON key, with correct initialism casing. */
function exportedName(key: string): string {
	const words = splitWords(key);
	let name = words
		.map((w) => {
			const up = w.toUpperCase();
			if (INITIALISMS.has(up)) return up;
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join('');
	if (!name) name = 'Field';
	if (/^[0-9]/.test(name)) name = '_' + name;
	return name;
}

function singularize(name: string): string {
	if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y');
	if (/(ses|xes|zes|ches|shes)$/i.test(name)) return name.replace(/es$/i, '');
	if (/ss$/i.test(name)) return name;
	if (/s$/i.test(name)) return name.replace(/s$/i, '');
	return name;
}

/** Name for a top-level array's element: the singular root, or `<Root>Item`. */
function elementName(root: string): string {
	const s = singularize(root);
	return s && s !== root ? s : root + 'Item';
}

interface Struct {
	name: string;
	code: string;
}

interface FieldRow {
	name: string;
	type: string;
	tag: string;
}

class GoEmitter {
	private structs: Struct[] = [];
	private bySig = new Map<string, string>();
	private used = new Set<string>();
	private needsTime = false;

	constructor(private opts: GoOptions) {}

	private anyType(): string {
		return this.opts.useAny ? 'any' : 'interface{}';
	}

	private uniqueName(base: string): string {
		if (!this.used.has(base)) {
			this.used.add(base);
			return base;
		}
		let i = 2;
		while (this.used.has(base + i)) i++;
		this.used.add(base + i);
		return base + i;
	}

	private sig(schema: Schema): string {
		return schema.shapes.map((s) => this.sigShape(s)).join('|') + (schema.nullable ? '?' : '');
	}

	private sigShape(shape: Shape): string {
		if (shape.kind === 'object') {
			return (
				'{' +
				[...shape.fields].map(([k, f]) => `${k}:${this.sig(f.schema)}`).join(';') +
				'}'
			);
		}
		if (shape.kind === 'array') return `[${this.sig(shape.element)}]`;
		return shape.prim;
	}

	/** A type is pointerable when a `*T` makes sense (not slices/maps/interfaces). */
	private pointerable(base: string): boolean {
		return !base.startsWith('[]') && !base.startsWith('map[') && base !== this.anyType();
	}

	/** Base Go type for a schema (no pointer; the field/element applies that). */
	private goType(schema: Schema, suggested: string, depth: number): string {
		if (schema.shapes.length === 0) return this.anyType(); // unknown
		if (schema.shapes.length > 1) return this.anyType(); // mixed union
		return this.shapeType(schema.shapes[0], suggested, depth);
	}

	private shapeType(shape: Shape, suggested: string, depth: number): string {
		if (shape.kind === 'prim') return this.primType(shape);
		if (shape.kind === 'array') return this.arrayType(shape, suggested, depth);
		return this.objectType(shape, suggested, depth);
	}

	private primType(shape: PrimShape): string {
		switch (shape.prim) {
			case 'boolean':
				return 'bool';
			case 'integer':
				return this.opts.intType;
			case 'number':
				return 'float64';
			case 'string':
				if (this.opts.detectTime && shape.date && shape.count > 0) {
					this.needsTime = true;
					return 'time.Time';
				}
				return 'string';
		}
	}

	private arrayType(shape: ArrayShape, suggested: string, depth: number): string {
		const el = shape.element;
		const base = this.goType(el, singularize(suggested), depth);
		const ptr = this.opts.pointersForNullable && el.nullable && this.pointerable(base);
		return '[]' + (ptr ? '*' : '') + base;
	}

	private objectType(shape: ObjectShape, suggested: string, depth: number): string {
		if (shape.fields.size === 0) return 'map[string]' + this.anyType();
		if (this.opts.inlineStructs) return this.inlineStruct(shape, depth);
		return this.nameStruct(shape, suggested);
	}

	private nameStruct(shape: ObjectShape, suggested: string): string {
		const sig = this.sigShape(shape);
		const existing = this.bySig.get(sig);
		if (existing) return existing;

		const name = this.uniqueName(exportedName(suggested));
		this.bySig.set(sig, name);
		const entry: Struct = { name, code: '' };
		this.structs.push(entry);
		entry.code = `type ${name} struct {\n${this.fieldLines(shape, 1).join('\n')}\n}`;
		return name;
	}

	private inlineStruct(shape: ObjectShape, depth: number): string {
		const inner = this.fieldLines(shape, depth + 1).join('\n');
		return `struct {\n${inner}\n${'\t'.repeat(depth)}}`;
	}

	/** Aligned `\t`-indented field lines for a struct at the given depth. */
	private fieldLines(shape: ObjectShape, depth: number): string[] {
		const rows: FieldRow[] = [];
		// Distinct JSON keys can collapse to the same exported Go identifier
		// (e.g. `user-id` and `user_id` both → `UserID`); suffix to keep the
		// struct compilable. The json tag still carries the original key.
		const usedNames = new Set<string>();
		for (const [key, field] of shape.fields) {
			const optional = isOptionalField(field, shape.count);
			const base = this.goType(field.schema, key, depth);
			const ptr =
				this.opts.pointersForNullable &&
				(field.schema.nullable || optional) &&
				this.pointerable(base);
			const type = (ptr ? '*' : '') + base;
			const tag = this.opts.jsonTags
				? '`json:"' + key + (this.opts.omitempty ? ',omitempty' : '') + '"`'
				: '';
			let name = exportedName(key);
			if (usedNames.has(name)) {
				let i = 2;
				while (usedNames.has(name + i)) i++;
				name += i;
			}
			usedNames.add(name);
			rows.push({ name, type, tag });
		}

		// Column widths from single-line types only (inline structs span lines).
		const nameW = Math.max(0, ...rows.map((r) => r.name.length));
		const typeW = Math.max(0, ...rows.filter((r) => !r.type.includes('\n')).map((r) => r.type.length));
		const indent = '\t'.repeat(depth);

		return rows.map((r) => {
			const namePad = r.name.padEnd(nameW);
			if (r.type.includes('\n')) {
				return `${indent}${namePad} ${r.type}${r.tag ? ' ' + r.tag : ''}`;
			}
			const typePad = r.tag ? r.type.padEnd(typeW) : r.type;
			return `${indent}${namePad} ${typePad}${r.tag ? ' ' + r.tag : ''}`.replace(/\s+$/, '');
		});
	}

	emit(schema: Schema): string {
		const rootName = exportedName(this.opts.rootName);

		const pureObjectRoot =
			schema.shapes.length === 1 &&
			schema.shapes[0].kind === 'object' &&
			!schema.nullable &&
			(schema.shapes[0] as ObjectShape).fields.size > 0;

		let body: string;
		if (pureObjectRoot) {
			this.nameStruct(schema.shapes[0] as ObjectShape, rootName);
			body = this.structs.map((s) => s.code).join('\n\n');
		} else if (schema.shapes.length === 1 && schema.shapes[0].kind === 'array' && !schema.nullable) {
			// Top-level array: `type Root []Elem`, element named cleanly.
			this.used.add(rootName);
			const el = (schema.shapes[0] as ArrayShape).element;
			const base = this.goType(el, elementName(rootName), 0);
			const ptr = this.opts.pointersForNullable && el.nullable && this.pointerable(base);
			const alias = `type ${rootName} []${ptr ? '*' : ''}${base}`;
			body = [alias, ...this.structs.map((s) => s.code)].join('\n\n');
		} else {
			this.used.add(rootName);
			const expr = this.goType(schema, rootName, 0);
			const alias = `type ${rootName} ${expr}`;
			body = [alias, ...this.structs.map((s) => s.code)].join('\n\n');
		}

		const header = this.needsTime ? 'import "time"\n\n' : '';
		return header + body + '\n';
	}
}

/**
 * Render a parsed JSON schema into Go struct declarations.
 */
export function emitGo(schema: Schema, options: Partial<GoOptions> = {}): string {
	const opts: GoOptions = { ...DEFAULT_GO_OPTIONS, ...options };
	return new GoEmitter(opts).emit(schema);
}
