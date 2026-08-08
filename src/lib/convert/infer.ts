/**
 * Structural type inference from a JSON sample — the shared front-end for the
 * JSON → TypeScript and JSON → Go generators.
 *
 * Lazy-loaded by the JsonConverter island. Pure and dependency-free.
 *
 * What makes the downstream output beat the field (quicktype, json2ts,
 * json-to-go) is all decided here:
 *   • Object shapes are MERGED across every element of an array, so a field that
 *     appears in some items but not others is correctly inferred as OPTIONAL,
 *     and a field that is sometimes null is inferred as NULLABLE.
 *   • Mixed types unify into a union (`string | number`) rather than collapsing
 *     to `any`; whole-number vs fractional numbers are tracked separately so Go
 *     can pick `int` vs `float64`.
 *   • Small, closed sets of string values are remembered as literals, so the
 *     TypeScript emitter can offer string-literal unions (enum-like types).
 *   • ISO-8601-looking strings are flagged so the Go emitter can map them to
 *     `time.Time`.
 *
 * The result is a `Schema`: a union of `Shape`s plus a `nullable` flag. An empty
 * shape list means "unknown" (seen only via empty arrays or all-null values).
 */

export type Prim = 'string' | 'integer' | 'number' | 'boolean';

export interface FieldInfo {
	schema: Schema;
	/** In how many of the parent object's samples this key was present. */
	present: number;
}

export interface ObjectShape {
	kind: 'object';
	/** First-seen insertion order is preserved. */
	fields: Map<string, FieldInfo>;
	/** Total object samples merged into this shape (for optional detection). */
	count: number;
}

export interface ArrayShape {
	kind: 'array';
	/** Merged schema of every element ever seen (empty schema if none). */
	element: Schema;
}

export interface PrimShape {
	kind: 'prim';
	prim: Prim;
	/** Distinct string values seen, or null once it overflows / isn't a string. */
	literals: Set<string> | null;
	/** True while every observed string looked like an ISO-8601 date/time. */
	date: boolean;
	count: number;
}

export type Shape = ObjectShape | ArrayShape | PrimShape;

export interface Schema {
	/** Union members. Empty == unknown/any. */
	shapes: Shape[];
	/** A JSON `null` was observed for this value. */
	nullable: boolean;
}

/** Beyond this many distinct strings, stop tracking literals (treat as open). */
const LITERAL_CAP = 12;

const DATE_RE =
	/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isDateLike(s: string): boolean {
	return DATE_RE.test(s);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function emptySchema(): Schema {
	return { shapes: [], nullable: false };
}

export function isAny(s: Schema): boolean {
	return s.shapes.length === 0;
}

// ── Build a schema from one value ────────────────────────────────────────────

function build(value: unknown): Schema {
	if (value === null) return { shapes: [], nullable: true };

	if (Array.isArray(value)) {
		let element = emptySchema();
		for (const item of value) element = mergeSchema(element, build(item));
		return { shapes: [{ kind: 'array', element }], nullable: false };
	}

	if (isPlainObject(value)) {
		const fields = new Map<string, FieldInfo>();
		for (const k of Object.keys(value)) fields.set(k, { schema: build(value[k]), present: 1 });
		return { shapes: [{ kind: 'object', fields, count: 1 }], nullable: false };
	}

	if (typeof value === 'string') {
		return {
			shapes: [{ kind: 'prim', prim: 'string', literals: new Set([value]), date: isDateLike(value), count: 1 }],
			nullable: false,
		};
	}

	if (typeof value === 'number') {
		const prim: Prim = Number.isInteger(value) ? 'integer' : 'number';
		return { shapes: [{ kind: 'prim', prim, literals: null, date: false, count: 1 }], nullable: false };
	}

	if (typeof value === 'boolean') {
		return { shapes: [{ kind: 'prim', prim: 'boolean', literals: null, date: false, count: 1 }], nullable: false };
	}

	return emptySchema();
}

// ── Merge two schemas / shapes ───────────────────────────────────────────────

/** Which shapes are allowed to merge into one another. Numeric prims unify. */
function shapeCategory(s: Shape): string {
	if (s.kind === 'prim') return s.prim === 'number' || s.prim === 'integer' ? 'num' : s.prim;
	return s.kind;
}

function mergeSchema(a: Schema, b: Schema): Schema {
	const shapes = a.shapes.slice();
	for (const sb of b.shapes) {
		const cat = shapeCategory(sb);
		const idx = shapes.findIndex((sa) => shapeCategory(sa) === cat);
		if (idx === -1) shapes.push(sb);
		else shapes[idx] = mergeShape(shapes[idx], sb);
	}
	return { shapes, nullable: a.nullable || b.nullable };
}

function mergeShape(a: Shape, b: Shape): Shape {
	if (a.kind === 'object' && b.kind === 'object') {
		const count = a.count + b.count;
		const fields = new Map<string, FieldInfo>();
		// a's keys first (preserve order), merging in b where they overlap.
		for (const [k, fa] of a.fields) {
			const fb = b.fields.get(k);
			fields.set(k, fb
				? { schema: mergeSchema(fa.schema, fb.schema), present: fa.present + fb.present }
				: { schema: fa.schema, present: fa.present });
		}
		// keys only in b.
		for (const [k, fb] of b.fields) {
			if (!fields.has(k)) fields.set(k, { schema: fb.schema, present: fb.present });
		}
		return { kind: 'object', fields, count };
	}

	if (a.kind === 'array' && b.kind === 'array') {
		return { kind: 'array', element: mergeSchema(a.element, b.element) };
	}

	if (a.kind === 'prim' && b.kind === 'prim') {
		const numeric = (p: Prim) => p === 'number' || p === 'integer';
		let prim: Prim;
		if (numeric(a.prim) && numeric(b.prim)) {
			prim = a.prim === 'number' || b.prim === 'number' ? 'number' : 'integer';
		} else {
			prim = a.prim;
		}
		let literals: Set<string> | null = null;
		if (prim === 'string') {
			if (a.literals && b.literals) {
				literals = new Set([...a.literals, ...b.literals]);
				if (literals.size > LITERAL_CAP) literals = null;
			}
		}
		return {
			kind: 'prim',
			prim,
			literals,
			date: a.date && b.date,
			count: a.count + b.count,
		};
	}

	// Categories guaranteed equal by the caller, so this is unreachable.
	return a;
}

/**
 * Infer a merged `Schema` for a parsed JSON value.
 */
export function inferSchema(value: unknown): Schema {
	return build(value);
}

/** True when a field should be rendered optional: absent from some samples. */
export function isOptionalField(field: FieldInfo, parentCount: number): boolean {
	return field.present < parentCount;
}
