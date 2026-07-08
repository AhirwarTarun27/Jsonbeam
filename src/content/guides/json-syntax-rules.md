---
title: 'JSON syntax rules, explained with examples'
description: 'Every rule that makes JSON valid — quoting, commas, numbers, escaping, and more — each shown with a correct and an incorrect example you can test yourself.'
publishDate: 2026-06-09
tags: ['Fundamentals']
relatedTools:
  - name: JSON Validator
    href: /json-validator
    desc: Pinpoint the exact position of a syntax error.
  - name: JSON Repair
    href: /json-repair
    desc: Auto-fix quotes, commas, and other slips.
  - name: JSON Formatter
    href: /json-formatter
    desc: Beautify valid JSON to read it clearly.
---

JSON has a reputation for being simple, and it is — but "simple" is not the same as "forgiving". The parser follows a short, strict set of rules, and breaking any one of them makes the entire document invalid. This guide lists those rules with a valid and an invalid example for each, so you can recognise a problem on sight. To watch the rules enforced in real time, paste any snippet below into the [JSON validator](/json-validator).

## Rule 1: The top level is a single value

A JSON document contains exactly **one** value at the top level. That value is usually an object or an array, but it can also be a lone string, number, boolean, or `null`.

```json
{ "ok": true }
```

Putting two values side by side with nothing joining them is invalid:

```txt
{ "a": 1 } { "b": 2 }   ← invalid: two top-level values
```

If you genuinely have multiple records, wrap them in an array, or use newline-delimited JSON (one document per line) and parse each line separately.

## Rule 2: Object keys must be double-quoted strings

Every key in an object is a string, and in JSON strings use **double quotes**. Unquoted keys and single-quoted keys are both invalid — this is the single most common mistake when copying an object out of JavaScript.

```json
{ "name": "Ada" }
```

```txt
{ name: "Ada" }    ← invalid: unquoted key
{ 'name': 'Ada' }  ← invalid: single quotes
```

## Rule 3: Strings use double quotes and escape special characters

String **values**, like keys, must be wrapped in double quotes. Certain characters have to be escaped with a backslash: the double quote `\"`, the backslash itself `\\`, and control characters such as newline `\n`, tab `\t`, and carriage return `\r`. Unicode can be written literally or as `\uXXXX`.

```json
{ "quote": "She said \"hi\"", "path": "C:\\temp", "line": "a\nb" }
```

```txt
{ "path": "C:\temp" }   ← invalid: \t is a tab, the backslash isn't escaped
```

A raw, unescaped newline inside a string is also invalid — the string must be on one logical line or use `\n`.

## Rule 4: No trailing commas

Commas separate items, so a comma before a closing `}` or `]` has nothing after it to separate and is rejected.

```json
{ "a": 1, "b": 2 }
```

```txt
{ "a": 1, "b": 2, }   ← invalid: trailing comma
[ 1, 2, 3, ]          ← invalid: trailing comma
```

This one bites constantly because most programming languages *do* allow trailing commas. If you have a stray comma, the [JSON repair](/json-repair) tool removes it automatically.

## Rule 5: Numbers follow a strict format

JSON has a single number type and a precise grammar for it. A number may have a minus sign, an integer part, an optional fractional part, and an optional exponent (`e`/`E`). It may **not** have a leading `+`, a leading zero on a multi-digit integer, a trailing dot, hex notation, or the special values `NaN` and `Infinity`.

```json
{ "a": -3.14, "b": 2.5e8, "c": 0 }
```

```txt
{ "a": +5 }       ← invalid: leading plus
{ "b": 007 }      ← invalid: leading zeros
{ "c": .5 }       ← invalid: needs a leading 0 → 0.5
{ "d": 5. }       ← invalid: trailing dot
{ "e": NaN }      ← invalid: NaN is not JSON
```

If you need `NaN`, `Infinity`, or big integers with exact precision, encode them as strings and convert them in your application.

## Rule 6: Only `true`, `false`, and `null` — lowercase

The three literal keywords are case-sensitive and must be written in lowercase, with no quotes (quoting them turns them into strings, which is a different value).

```json
{ "enabled": true, "deletedAt": null }
```

```txt
{ "enabled": True }   ← invalid: capital T (that's Python, not JSON)
{ "enabled": TRUE }   ← invalid
```

Note the subtle distinction: `"true"` (with quotes) is a perfectly valid JSON **string**; `true` is a boolean. They are not the same value, and mixing them up causes real bugs downstream.

## Rule 7: No comments

JSON has no comment syntax. Neither `//` nor `/* */` is allowed, which surprises people using it for config files.

```txt
{
  // the user's id      ← invalid: comments aren't part of JSON
  "id": 7
}
```

If you need annotated config, add a normal string field (for example `"_comment": "…"`), or use a superset such as JSON5 or JSONC and convert it to strict JSON before shipping.

## Rule 8: Whitespace between tokens is ignored

Spaces, tabs, and newlines **between** tokens carry no meaning. That is why the same data can be written as a dense single line or an indented block, and why you can freely [format](/json-formatter) or [minify](/json-minifier) a document without changing what it represents.

```json
{"a":1,"b":2}
```

is identical, as data, to:

```json
{
  "a": 1,
  "b": 2
}
```

## When you hit an error

Because the parser stops at the first violation, a single misplaced character can produce a confusing message pointing at a line that looks fine. The practical workflow is:

1. Run the document through the [JSON validator](/json-validator) to get the exact line and column of the first error.
2. Fix that one issue — it is almost always one of the rules above.
3. Re-validate, because a repair can reveal the *next* error that the parser never reached.

For messy input with many small mistakes at once, the [JSON repair](/json-repair) tool applies these rules for you and returns clean, valid JSON. When you understand *why* each fix was made, you will start writing valid JSON by habit. The [common JSON errors](/blog/common-json-errors) guide catalogues the specific messages you are most likely to see and what each one means.
