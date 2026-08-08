---
title: 'Generating TypeScript types from JSON'
description: 'How to turn a JSON sample into accurate TypeScript interfaces — inferring types, handling optional and nullable fields, arrays and unions, and the limits of inference.'
publishDate: 2026-07-06
tags: ['Converting']
relatedTools:
  - name: JSON to TypeScript
    href: /json-to-typescript
    desc: Generate interfaces from a JSON sample.
  - name: JSON to Go
    href: /json-to-go
    desc: Generate Go structs the same way.
  - name: JSON Formatter
    href: /json-formatter
    desc: Tidy the sample before generating.
---

If you consume JSON APIs in a TypeScript codebase, hand-writing the interfaces for every response is tedious and error-prone. Generating them from a real sample is faster and more accurate — the shape comes straight from actual data. But inference has limits worth understanding, so the generated types are a strong starting point rather than a finished contract. This guide covers both, and the [JSON to TypeScript converter](/json-to-typescript/) produces the types instantly in your browser.

## Why typed JSON boundaries matter

The edge where external JSON enters your app is the riskiest place in a TypeScript project. Inside your code the compiler protects you, but a JSON response is `any` until you describe its shape. Giving it a precise `interface` means autocomplete, refactoring safety, and compile-time errors when the API changes — instead of a mysterious `undefined` at runtime.

## From sample to interface

Given this response:

```json
{
  "id": 4021,
  "name": "Ada",
  "active": true,
  "roles": ["admin", "editor"],
  "profile": { "city": "London", "joined": "2026-01-14" }
}
```

a generator infers each field's type from its value and produces nested interfaces:

```ts
interface Profile {
  city: string;
  joined: string;
}

interface User {
  id: number;
  name: string;
  active: boolean;
  roles: string[];
  profile: Profile;
}
```

Note how `profile` becomes its own named interface and `roles` is typed as `string[]` from the array's elements. That structural mapping is exactly what you would write by hand, without the typing effort.

## Optional and nullable fields

Two subtleties trip people up:

- **`null` vs optional.** A field present with value `null` becomes `field: string | null`. A field that is *sometimes absent* should become `field?: string`. A single sample cannot tell these apart — it only sees what is there.
- **Dates are strings.** JSON has no date type, so `"2026-01-14"` is inferred as `string`. If you parse it into a `Date`, adjust the type after generation.

## Arrays and unions

- **Arrays of objects** yield an interface for the element type: `items: Item[]`.
- **Mixed-type arrays** (rare, but real) infer a union like `(string | number)[]`.
- **Empty arrays** are ambiguous — `[]` gives the generator nothing to infer, so it falls back to `unknown[]` or `any[]`. Provide a sample with at least one element where you can.

## The limits of inference (and how to fix them)

A generated type is only as complete as the sample it came from. Keep three limits in mind:

1. **One sample = one shape.** If the API omits `phone` for some users, a sample that happens to include it will mark `phone` as required. Generate from a representative record — ideally one with every field — and then relax fields to optional by hand.
2. **No constraints.** Inference gives you `string`, not `"admin" | "editor"`. If a field is really an enum, tighten it manually to a string-literal union for extra safety.
3. **Numbers are just `number`.** TypeScript has no integer type, so `id: number` is as precise as it gets; encode big integers as strings if precision matters (see [what is JSON](/blog/what-is-json/)).

The pragmatic workflow is: **generate, then refine.** Let the tool do the 90% of mechanical work, then spend a minute marking optional fields, narrowing enums, and fixing dates.

## A quick workflow

1. Grab a **complete, representative** JSON response from the API.
2. **[Format it](/json-formatter/)** and skim it so you know which fields are optional in practice.
3. Paste it into the [JSON to TypeScript converter](/json-to-typescript/) to get interfaces — locally, with nothing uploaded, which matters when the sample contains tokens or personal data.
4. **Refine** the output: optional markers, enums, and date types.

Need the same thing in another language? The [JSON to Go converter](/json-to-go/) applies the identical idea to Go structs with JSON tags. Understanding how a sample maps to a type also makes you better at reading unfamiliar APIs — a skill that pays off every time you integrate a new service.
