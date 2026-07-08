---
title: 'How to convert JSON to CSV, including nested data'
description: 'Why JSON and CSV do not map one-to-one, how to flatten nested objects and arrays into columns, and how to handle escaping — with a converter you can run instantly.'
publishDate: 2026-07-04
tags: ['Converting']
relatedTools:
  - name: JSON to CSV
    href: /json-to-csv
    desc: Flatten nested JSON into a spreadsheet.
  - name: JSON Table Viewer
    href: /json-table-viewer
    desc: Preview JSON arrays as rows and columns.
  - name: JSON Formatter
    href: /json-formatter
    desc: Inspect the JSON before converting.
---

Converting JSON to CSV sounds trivial — both hold tabular-ish data — but there is a real impedance mismatch underneath. JSON is a **tree** that can nest to any depth; CSV is a flat **grid** of rows and columns. Getting from one to the other means making deliberate choices about how nesting collapses. This guide explains those choices so your spreadsheet comes out clean, and the [JSON to CSV converter](/json-to-csv) applies them for you in the browser.

## The core mismatch

CSV assumes every record is a flat set of named fields. JSON records routinely contain nested objects and arrays. Consider:

```json
[
  {
    "id": 1,
    "name": "Ada",
    "address": { "city": "London", "zip": "EC1" },
    "tags": ["admin", "editor"]
  }
]
```

There is no single "obviously correct" CSV for this — you have to decide how `address` (a nested object) and `tags` (an array) become columns.

## Flattening nested objects with path keys

The standard approach for nested objects is **dot-notation flattening**: a nested key becomes a column named by its path. `address.city` and `address.zip` turn into two columns:

| id | name | address.city | address.zip |
|---|---|---|---|
| 1 | Ada | London | EC1 |

This is lossless for objects and keeps the header readable. Deeply nested structures simply produce longer column names like `profile.contact.email`.

## Handling arrays

Arrays are the genuinely hard part, because a cell holds one value but an array holds many. There are three common strategies, each with trade-offs:

- **Join into one cell.** Turn `["admin", "editor"]` into `"admin, editor"` in a single `tags` column. Simple and compact; you lose the ability to treat elements separately.
- **Index into columns.** Produce `tags.0` and `tags.1` columns. Preserves each element but the column count varies by row and can explode for long arrays.
- **Explode into rows.** Emit one row per array element, repeating the other fields. Great for analysis (each tag becomes its own record) but multiplies row count.

Which is right depends on what you will do with the CSV. For a quick spreadsheet, joining is usually fine; for data analysis, exploding is often better. Preview the shape first in the [table viewer](/json-table-viewer) to decide.

## Getting the columns right

A robust conversion looks at *all* records to build the header, not just the first one — because records often differ. If the first user has no `phone` but the second does, the header still needs a `phone` column, with empty cells where the value is absent. When you convert with a tool that scans the whole array, you avoid the classic bug where later fields silently vanish.

## Escaping: the rules that keep CSV valid

CSV has a small but strict quoting standard (RFC 4180) that matters the moment your data contains punctuation:

- A field containing a **comma**, a **double quote**, or a **newline** must be wrapped in double quotes.
- A literal double quote inside a quoted field is escaped by **doubling it**: `He said ""hi""`.

```csv
id,name,note
1,Ada,"Note with a comma, and ""quotes"""
```

Skipping this is why hand-rolled exports break when opened in a spreadsheet — a stray comma shifts every following column. A good converter handles the quoting automatically.

## A clean conversion workflow

1. **[Format the JSON](/json-formatter)** and confirm it is an array of records (or wrap a single object in `[ … ]`).
2. **Preview it in the [table viewer](/json-table-viewer)** to see how it maps to rows and columns and to spot nesting.
3. **Decide your array strategy** — join, index, or explode — based on what the CSV is for.
4. **Convert with the [JSON to CSV tool](/json-to-csv).** It flattens nested objects with path keys, applies RFC 4180 quoting, and builds a complete header from every record — all locally, so nothing is uploaded.

## Edge cases worth knowing

- **`null` values** typically become empty cells; be explicit about whether empty means "null" or "missing".
- **Booleans and numbers** are written as-is (`true`, `42`); if a downstream tool needs `1`/`0`, transform them first.
- **Unicode** is preserved; save the CSV as UTF-8 so accented characters and emoji survive the trip into a spreadsheet.

Once you understand flattening and escaping, JSON-to-CSV stops being lossy guesswork. For the reverse-direction mindset and other transforms, see [generating TypeScript types from JSON](/blog/json-to-typescript-types) and [JSON vs YAML](/blog/json-vs-yaml).
