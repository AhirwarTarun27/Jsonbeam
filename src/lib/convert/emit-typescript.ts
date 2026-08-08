/**
 * Schema → TypeScript generator. Lazy-loaded by the JsonConverter island.
 *
 * Consumes the merged `Schema` from `infer.ts`, so it inherits optional-field,
 * nullable, union, and string-literal inference for free, then renders idiomatic
 * TypeScript with a rich option surface:
 *   • `interface` or `type` declarations.
 *   • Optional style: `field?: T` or `field: T | undefined`.
 *   • `readonly` properties, `export` keyword, `T[]` vs `Array<T>`.
 *   • `unknown` vs `any` for empty/unknown values.
 *   • Opt-in string-literal unions (enum-like) from closed value sets.
 *
 * Identical nested shapes are de-duplicated to a single named interface, and the
 * root type is emitted first.
 */

import {
	isOptionalField,
	type ArrayShape,
	type ObjectShape,
	type PrimShape,
	type Schema,
	type Shape,
} from './infer';

export interface TsOptions {
	rootName: string;
	declaration: 'interface' | 'type';
	optionalStyle: 'question' | 'union-undefined';
	useReadonly: boolean;
	export: boolean;
	arrayStyle: 'brackets' | 'generic';
	preferUnknown: boolean;
	/** Infer string-literal unions from small closed sets of values. */
	enums: boolean;
}

export const DEFAULT_TS_OPTIONS: TsOptions = {
	rootName: 'Root',
	declaration: 'interface',
	optionalStyle: 'question',
	useReadonly: false,
	export: true,
	arrayStyle: 'brackets',
	preferUnknown: true,
	enums: false,
};

const ID_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function pascalCase(raw: string): string {
	const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
	let name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
	if (!name) name = 'Type';
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

interface Iface {
	name: string;
	code: string;
}

class TsEmitter {
	private interfaces: Iface[] = [];
	private bySig = new Map<string, string>();
	private used = new Set<string>();

	constructor(private opts: TsOptions) {}

	private anyType(): string {
		return this.opts.preferUnknown ? 'unknown' : 'any';
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

	/** Structural signature for de-duplicating identical shapes. */
	private sig(schema: Schema): string {
		const parts = schema.shapes.map((s) => this.sigShape(s));
		return parts.join('|') + (schema.nullable ? '?' : '');
	}

	private sigShape(shape: Shape): string {
		if (shape.kind === 'object') {
			const fields = [...shape.fields]
				.map(([k, f]) => `${k}${isOptionalField(f, shape.count) ? '?' : ''}:${this.sig(f.schema)}`)
				.join(';');
			return `{${fields}}`;
		}
		if (shape.kind === 'array') return `[${this.sig(shape.element)}]`;
		return shape.prim;
	}

	private typeExpr(schema: Schema, suggested: string): string {
		const parts = schema.shapes.map((s) => this.shapeExpr(s, suggested));
		if (schema.nullable) parts.push('null');
		if (parts.length === 0) parts.push(this.anyType());
		// De-duplicate identical member expressions, keep order.
		const seen = new Set<string>();
		const uniq = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
		return uniq.join(' | ');
	}

	private shapeExpr(shape: Shape, suggested: string): string {
		if (shape.kind === 'prim') return this.primExpr(shape);
		if (shape.kind === 'array') return this.arrayExpr(shape, suggested);
		return this.objectExpr(shape, suggested);
	}

	private primExpr(shape: PrimShape): string {
		if (shape.prim === 'boolean') return 'boolean';
		if (shape.prim === 'integer' || shape.prim === 'number') return 'number';
		// string — maybe a literal union. Only when the values form a closed set:
		// at least two distinct values that actually REPEAT across samples
		// (count > distinct), so unique free-form fields stay `string`.
		if (
			this.opts.enums &&
			shape.literals &&
			shape.literals.size >= 2 &&
			shape.count > shape.literals.size
		) {
			return [...shape.literals]
				.sort()
				.map((v) => JSON.stringify(v))
				.join(' | ');
		}
		return 'string';
	}

	private arrayExpr(shape: ArrayShape, suggested: string): string {
		const elem = this.typeExpr(shape.element, singularize(suggested));
		if (this.opts.arrayStyle === 'generic') return `Array<${elem}>`;
		// Brackets style needs parens around unions.
		return elem.includes(' | ') ? `(${elem})[]` : `${elem}[]`;
	}

	private objectExpr(shape: ObjectShape, suggested: string): string {
		if (shape.fields.size === 0) {
			return this.opts.preferUnknown ? 'Record<string, unknown>' : 'Record<string, any>';
		}
		return this.nameObject(shape, suggested);
	}

	/** Assign (or reuse) a named interface for an object shape. Reserves the name
	 *  before building the body so recursive references resolve cleanly. */
	private nameObject(shape: ObjectShape, suggested: string): string {
		const sig = this.sigShape(shape);
		const existing = this.bySig.get(sig);
		if (existing) return existing;

		const name = this.uniqueName(pascalCase(suggested));
		this.bySig.set(sig, name);
		const entry: Iface = { name, code: '' };
		this.interfaces.push(entry); // discovery order → parent before children
		entry.code = this.buildBody(name, shape);
		return name;
	}

	private buildBody(name: string, shape: ObjectShape): string {
		const o = this.opts;
		const ro = o.useReadonly ? 'readonly ' : '';
		const exp = o.export ? 'export ' : '';
		const lines: string[] = [];

		for (const [key, field] of shape.fields) {
			const keyText = ID_RE.test(key) ? key : JSON.stringify(key);
			const optional = isOptionalField(field, shape.count);
			const valueExpr = this.typeExpr(field.schema, key);
			if (optional && o.optionalStyle === 'question') {
				lines.push(`  ${ro}${keyText}?: ${valueExpr};`);
			} else if (optional) {
				lines.push(`  ${ro}${keyText}: ${valueExpr} | undefined;`);
			} else {
				lines.push(`  ${ro}${keyText}: ${valueExpr};`);
			}
		}

		const body = lines.join('\n');
		if (o.declaration === 'type') return `${exp}type ${name} = {\n${body}\n};`;
		return `${exp}interface ${name} {\n${body}\n}`;
	}

	emit(schema: Schema): string {
		const o = this.opts;
		const rootName = pascalCase(o.rootName);

		const pureObjectRoot =
			schema.shapes.length === 1 &&
			schema.shapes[0].kind === 'object' &&
			!schema.nullable &&
			(schema.shapes[0] as ObjectShape).fields.size > 0;

		if (pureObjectRoot) {
			this.nameObject(schema.shapes[0] as ObjectShape, rootName);
			return this.interfaces.map((i) => i.code).join('\n\n') + '\n';
		}

		const exp = o.export ? 'export ' : '';
		this.used.add(rootName); // reserve for the alias

		// A top-level array: name the element cleanly (`RootItem` / singular root)
		// rather than letting it fall through to an auto-suffixed name.
		if (schema.shapes.length === 1 && schema.shapes[0].kind === 'array' && !schema.nullable) {
			const elem = this.typeExpr((schema.shapes[0] as ArrayShape).element, elementName(rootName));
			const inner = elem.includes(' | ') ? `(${elem})[]` : `${elem}[]`;
			const alias = `${exp}type ${rootName} = ${inner};`;
			return [alias, ...this.interfaces.map((i) => i.code)].join('\n\n') + '\n';
		}

		const expr = this.typeExpr(schema, rootName);
		const alias = `${exp}type ${rootName} = ${expr};`;
		return [alias, ...this.interfaces.map((i) => i.code)].join('\n\n') + '\n';
	}
}

/**
 * Render a parsed JSON schema into TypeScript declarations.
 */
export function emitTypeScript(schema: Schema, options: Partial<TsOptions> = {}): string {
	const opts: TsOptions = { ...DEFAULT_TS_OPTIONS, ...options };
	return new TsEmitter(opts).emit(schema);
}
