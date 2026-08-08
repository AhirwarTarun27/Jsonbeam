---
title: 'What is JSON? A practical guide for developers'
description: 'A clear, example-driven explanation of what JSON is, how it is structured, the data types it supports, and where it is used — with JSON you can try instantly.'
publishDate: 2026-06-02
tags: ['Fundamentals']
relatedTools:
  - name: JSON Formatter
    href: /json-formatter
    desc: Beautify and inspect any JSON in your browser.
  - name: JSON Viewer
    href: /json-viewer
    desc: Explore nested JSON as a collapsible tree.
  - name: JSON Validator
    href: /json-validator
    desc: Check that your JSON is well-formed.
---

JSON is the format that quietly powers most of the modern web. Every time an app loads your profile, a mobile game syncs your progress, or one service talks to another over an API, there is a very good chance the data travels as JSON. Yet a surprising number of developers use it every day without a precise mental model of what it actually is. This guide fixes that — plainly, with examples you can paste into the [JSON formatter](/json-formatter/) as you read.

## JSON in one sentence

**JSON (JavaScript Object Notation) is a lightweight, text-based format for representing structured data as a hierarchy of key–value pairs and ordered lists.** It was derived from the way JavaScript writes objects, but it is now completely language-independent: Python, Go, Rust, Java, C#, PHP, and essentially every other language can read and write it.

The key word is **text**. A JSON document is just a string of characters. That is what makes it so portable — it can be saved to a file, sent over HTTP, stored in a database column, or printed to a log, and any system that understands the rules can reconstruct the original data structure from it.

## The shape of JSON

JSON is built from exactly two container types and a handful of primitive values.

- An **object** is an unordered set of key–value pairs, wrapped in curly braces `{ }`. Keys are always strings; values can be anything.
- An **array** is an ordered list of values, wrapped in square brackets `[ ]`.

Here is a small but realistic example — an API response describing a user:

```json
{
  "id": 4021,
  "name": "Ada Lovelace",
  "active": true,
  "roles": ["admin", "editor"],
  "profile": {
    "city": "London",
    "joined": "2026-01-14"
  },
  "deletedAt": null
}
```

Read it top to bottom: the outer `{ }` is an object with six keys. `id` maps to a number, `name` to a string, `active` to a boolean, `roles` to an array of strings, `profile` to a nested object, and `deletedAt` to `null`. That nesting — objects inside objects, arrays inside objects — is how JSON represents data of any depth. Open this in the [JSON viewer](/json-viewer/) and you can expand and collapse each branch.

## The data types JSON supports

JSON deliberately keeps its type system tiny. There are only six:

| Type | Example | Notes |
|---|---|---|
| String | `"hello"` | Always double-quoted. Supports escapes like `\n` and `é`. |
| Number | `42`, `-3.14`, `2.5e8` | One numeric type; no separate int/float, no `NaN` or `Infinity`. |
| Boolean | `true`, `false` | Lowercase only. |
| Null | `null` | Represents "no value". |
| Object | `{ "k": "v" }` | Keys must be strings. |
| Array | `[1, 2, 3]` | Ordered; values may be mixed types. |

That is the entire vocabulary. There is no date type, no `undefined`, no functions, and no comments. Dates are conventionally encoded as ISO-8601 strings (as `joined` is above), and anything richer has to be modelled with these six building blocks. This minimalism is a feature: fewer types means fewer ways for two systems to disagree.

## JSON is not the same as a JavaScript object

Because JSON grew out of JavaScript, people often assume they are interchangeable. They are not. JSON is a strict *subset* of JavaScript's object syntax with tighter rules:

- Keys **must** be double-quoted in JSON (`{"name": …}`), whereas JavaScript allows unquoted keys.
- Strings **must** use double quotes; single quotes are invalid JSON.
- Trailing commas are allowed in JavaScript arrays and objects but **forbidden** in JSON.
- JavaScript-only values like `undefined`, functions, and `Infinity` cannot appear in JSON.

These differences are the source of a huge share of real-world "invalid JSON" errors. If you have ever copied an object out of your code and had a parser reject it, one of these rules is usually why. The dedicated guide on [JSON syntax rules](/blog/json-syntax-rules/) walks through each one, and the [common JSON errors](/blog/common-json-errors/) guide shows how to fix them fast.

## Where JSON is used

Once you start looking, JSON is everywhere:

- **Web APIs.** REST and most HTTP APIs return JSON bodies. When your front end calls a back end, JSON is almost always what comes back.
- **Configuration files.** `package.json`, `tsconfig.json`, VS Code settings, cloud infrastructure manifests — countless tools read their config as JSON.
- **Data storage.** Document databases such as MongoDB store records that are effectively JSON, and relational databases now have native JSON columns.
- **Logging and messaging.** Structured logs and message-queue payloads are frequently line-delimited JSON, which is easy to search and parse.

Its ubiquity is precisely why good JSON tooling matters: you will be reading, checking, and reshaping it constantly.

## How programs read and write JSON

Turning JSON text into in-memory data is called **parsing** (or deserializing); turning data back into text is **serializing** (or stringifying). In JavaScript the two built-ins are:

```js
const data = JSON.parse('{"active": true}'); // text  → object
const text = JSON.stringify(data);           // object → text
```

Every language has an equivalent. The important thing to understand is that parsing is strict: if the text breaks a single rule, the parser throws an error and gives you nothing. That is why validating and repairing JSON is a distinct, useful step rather than an afterthought.

## Common gotchas for newcomers

- **A bare value can be valid JSON.** `42`, `"hi"`, and `true` are all legal JSON documents on their own — the top level does not have to be an object.
- **Key order is not guaranteed to matter.** Objects are conceptually unordered; do not rely on key position for meaning.
- **Numbers have limits.** Very large integers can lose precision because JSON numbers map to floating point in many languages. When exact big integers matter, encode them as strings.
- **Whitespace is insignificant.** Indentation makes JSON readable but changes nothing about the data — which is exactly why you can freely [format](/json-formatter/) or [minify](/json-minifier/) it.

## Try it yourself

The fastest way to build intuition is to poke at real JSON. Paste the user example above into the [JSON formatter](/json-formatter/) to pretty-print it, open it in the [JSON viewer](/json-viewer/) to explore the tree, or run it through the [validator](/json-validator/) to see how errors are reported when you deliberately break a rule. Everything happens locally in your browser — the data you experiment with is never uploaded.

Once the shape and the six types feel natural, JSON stops being something you fight and becomes something you barely think about. From here, the [JSON syntax rules](/blog/json-syntax-rules/) guide is the natural next step.
