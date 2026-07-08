---
title: 'How to compare two JSON files'
description: 'Why a plain text diff misleads for JSON, how a semantic diff compares structure instead, and the standards (JSON Patch, Merge Patch) for describing changes.'
publishDate: 2026-07-07
tags: ['Comparing']
relatedTools:
  - name: JSON Diff
    href: /json-diff
    desc: Compare two documents structurally.
  - name: JSON Formatter
    href: /json-formatter
    desc: Normalise both files before comparing.
---

Comparing two JSON documents — a config before and after a change, two API responses, an expected vs actual test fixture — is something developers do constantly. The trap is reaching for a plain text diff, which reports dozens of "changes" that are not changes at all. A **semantic** diff, one that understands JSON's structure, gives you the answer you actually want. This guide explains the difference and the standards involved, and the [JSON diff tool](/json-diff) does the comparison in your browser.

## Why a text diff misleads

A line-based diff compares characters, not meaning. For JSON that produces false positives everywhere:

- **Key order.** JSON objects are conceptually unordered, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are the *same data* — but a text diff flags every reordered line as changed.
- **Formatting.** Different indentation, spacing, or minified vs pretty-printed output makes two identical documents look completely different line by line.
- **Trailing commas and whitespace.** Cosmetic differences drown out the one real change you were looking for.

The result is a diff full of noise where a single value actually changed. You end up hunting for the needle by hand.

## What a semantic diff does instead

A semantic (structural) diff parses both documents into data first, then compares the **structures**. It ignores key order and formatting and reports only meaningful differences, classified by kind:

- **Added** — a key or element present in the second document but not the first.
- **Removed** — present in the first but not the second.
- **Changed** — the same key exists in both but its value differs.

So comparing `{"a":1,"b":2}` with `{"b":2,"a":3}` yields exactly one finding — `a` changed from `1` to `3` — regardless of how either file was formatted. That is the signal you wanted, without the noise.

## The subtlety of arrays

Objects are compared by key, which is unambiguous. Arrays are harder because they are ordered and elements have no stable identifier. Two reasonable interpretations exist:

- **By index** — compare position 0 to position 0, and so on. Simple, but inserting one element near the top makes everything after it look "changed".
- **By identity** — match elements by a key (like `id`) and diff the matched pairs. Smarter for lists of records, but requires knowing which field identifies an element.

Knowing which model your diff uses explains its output. For lists of records, matching by a stable id gives the most intuitive result; for fixed-length tuples, by-index is fine.

## Standards for describing changes

Sometimes you do not just want to *see* the difference — you want to *transmit* it. Two IETF standards encode JSON changes as data:

- **JSON Patch (RFC 6902)** describes a change as a sequence of operations: `add`, `remove`, `replace`, `move`, `copy`, `test`. It is precise and can express any transformation, which is why APIs use it for partial updates.
- **JSON Merge Patch (RFC 7396)** describes a change as a small JSON document that looks like the target: present keys are set, and a key set to `null` means "delete this". It is simpler and more intuitive for straightforward updates, though it cannot represent some operations (like setting a value *to* null).

Understanding these helps you read change payloads from APIs and choose the right one when designing your own.

## A practical comparison workflow

1. **[Format both documents](/json-formatter)** — or better, let the diff tool normalise them so formatting differences never enter the picture.
2. **Run the [JSON diff](/json-diff)** to get a structural comparison that highlights added, removed, and changed values.
3. **Focus on the classified findings**, not raw lines. Confirm each change is intended.
4. For lists of records, check whether the tool matches array elements by index or by id, so you interpret array changes correctly.

Everything runs locally in your browser, so comparing two production configs or two responses full of customer data never uploads either file. Once you are comparing by structure instead of by text, reviewing JSON changes becomes fast and reliable. To make both sides directly comparable in the first place, a consistent formatting habit helps — see [JSON formatting best practices](/blog/json-formatting-best-practices).
