---
title: 'Common JSON errors and how to fix them'
description: 'The JSON errors you actually hit — trailing commas, single quotes, unexpected tokens, truncated input — what each message means, and the exact fix for each.'
publishDate: 2026-06-16
tags: ['Troubleshooting']
relatedTools:
  - name: JSON Repair
    href: /json-repair
    desc: Auto-fix the mistakes below in one click.
  - name: JSON Validator
    href: /json-validator
    desc: Find the exact line and column of an error.
  - name: JSON Formatter
    href: /json-formatter
    desc: Reformat once the JSON is valid again.
---

Parsers reject invalid JSON with a terse, sometimes cryptic message and refuse to go further. The good news is that the same handful of mistakes account for the overwhelming majority of real errors. Learn to recognise them and most "invalid JSON" problems become a ten-second fix. Below are the usual suspects, the messages they produce, and how to fix each — and for anything messy, the [JSON repair](/json-repair) tool applies these fixes automatically.

## Trailing commas

By far the most common. A comma before a closing `}` or `]` has nothing to separate:

```txt
{ "a": 1, "b": 2, }
```

Typical messages: *"Unexpected token } in JSON"* or *"Expecting property name enclosed in double quotes"*. **Fix:** delete the comma before the closing bracket. Because most programming languages allow trailing commas, this slips in constantly when JSON is hand-edited or copied from code.

## Single quotes instead of double quotes

JSON strings and keys must use double quotes. Single quotes are a JavaScript habit that JSON does not share:

```txt
{ 'name': 'Ada' }
```

Message: *"Unexpected token ' in JSON"* or *"Expecting property name enclosed in double quotes"*. **Fix:** replace every `'` around a key or string value with `"`.

## Unquoted keys

Closely related: keys written bare, as they can be in JavaScript objects:

```txt
{ name: "Ada" }
```

**Fix:** wrap each key in double quotes → `{ "name": "Ada" }`.

## Missing or extra commas between items

Every pair of items in an object or array needs exactly one comma between them — no more, no fewer:

```txt
{ "a": 1 "b": 2 }     ← missing comma
{ "a": 1,, "b": 2 }   ← extra comma
```

Message: *"Unexpected string"* or *"Unexpected token ,"*. **Fix:** ensure a single comma separates each item and none trails the last one.

## Unexpected end of input (unclosed brackets)

If a `{`, `[`, or `"` is never closed, the parser reaches the end still waiting:

```txt
{ "items": [1, 2, 3
```

Message: *"Unexpected end of JSON input"* or *"Unterminated string"*. **Fix:** count your opening and closing brackets — a formatter's indentation makes an unbalanced structure obvious. Truncated API responses and copy-paste that missed the last line are frequent causes.

## Extra content after the JSON

A document holds one top-level value. Two objects in a row, or a stray character after the final bracket, fails:

```txt
{ "a": 1 } { "b": 2 }
```

Message: *"Unexpected non-whitespace character after JSON"*. **Fix:** wrap multiple records in an array `[ … ]`, or if the source is newline-delimited JSON, split on newlines and parse each line on its own.

## Smart quotes and invisible characters

Copying JSON out of a word processor, chat app, or PDF can silently replace straight quotes `"` with "curly" quotes `“ ”`, or insert a byte-order mark (BOM) or non-breaking spaces:

```txt
{ “name”: “Ada” }   ← curly quotes, not valid JSON
```

Message: *"Unexpected token"* pointing at a character that looks correct. **Fix:** retype the quotes as straight double quotes, or run the text through the [repair tool](/json-repair), which normalises these characters for you.

## JavaScript-only values

`NaN`, `Infinity`, `undefined`, function expressions, and comments are all valid JavaScript but not JSON:

```txt
{ "ratio": NaN, "note": undefined /* pending */ }
```

**Fix:** replace `NaN`/`Infinity` with `null` or a string, drop `undefined` keys entirely, and remove comments. See the [JSON syntax rules](/blog/json-syntax-rules) guide for why these are excluded.

## Malformed numbers

Leading zeros, a leading `+`, a trailing dot, or a missing leading zero all break the number grammar:

```txt
{ "a": 007, "b": +5, "c": 5., "d": .5 }
```

**Fix:** write them as `7`, `5`, `5.0`, and `0.5`. If a value must keep leading zeros (like a ZIP code or product SKU), it is not really a number — quote it as a string.

## Duplicate keys

```json
{ "id": 1, "id": 2 }
```

This is technically parseable — most parsers silently keep the **last** value — but it is almost always a bug, and some strict tools reject it. **Fix:** make each key unique; if you meant a collection, use an array.

## A reliable fix workflow

Because a parser stops at the *first* error, fixing one problem often reveals the next. Work iteratively:

1. Paste the document into the [JSON validator](/json-validator) to get the precise line and column of the first error.
2. Apply the matching fix from above.
3. Re-validate — repeat until it is clean.
4. Once valid, [format it](/json-formatter) so it is easy to read and review.

When there are many small mistakes at once — the typical result of hand-editing or a bad export — skip the manual loop and run the [JSON repair](/json-repair) tool, which corrects quotes, commas, brackets, and stray characters in a single pass and returns valid JSON. Everything runs locally in your browser, so even broken files containing secrets never leave your device. To go deeper on reading the messages themselves, continue with [how to validate JSON](/blog/how-to-validate-json).
