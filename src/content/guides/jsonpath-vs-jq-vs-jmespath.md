---
title: 'JSONPath vs jq vs JMESPath: which query language?'
description: 'A side-by-side comparison of the three main JSON query languages — JSONPath, jq, and JMESPath — with the same queries in each and guidance on when to use which.'
publishDate: 2026-06-30
tags: ['Querying']
relatedTools:
  - name: JSON Query
    href: /json-query
    desc: Run JSONPath, JMESPath, and jq queries live.
  - name: JSON Viewer
    href: /json-viewer
    desc: Explore the structure before you query it.
---

When a JSON document gets big, you stop wanting to *read* it and start wanting to *ask questions of it* — "give me the names of every active user", "sum these line items", "find the record with this id". Three query languages dominate that job: **JSONPath**, **jq**, and **JMESPath**. They overlap, but they are not interchangeable, and picking the right one saves real time. This guide compares them on the same data, which you can run yourself in the [JSON query tool](/json-query).

## The sample data

All examples below query this document:

```json
{
  "users": [
    { "name": "Ada", "active": true, "age": 36 },
    { "name": "Grace", "active": false, "age": 45 },
    { "name": "Linus", "active": true, "age": 29 }
  ]
}
```

## The three languages at a glance

| | JSONPath | jq | JMESPath |
|---|---|---|---|
| Origin | Inspired by XPath; standardised as RFC 9535 | A command-line JSON processor | A spec used across the AWS CLI/SDKs |
| Style | Path expressions with `$` | A pipeline/transformation language | Path expressions with functions |
| Transforms data? | Mostly selects | Yes — full transformation | Selects + reshapes |
| Best for | Quick extraction | Anything complex | Embedded, predictable querying |

## "Get every user's name"

**JSONPath** treats `$` as the root and walks a path, using `[*]` for "every element":

```txt
$.users[*].name
```

**jq** pipes the array into an iterator `.[]` and projects `.name`:

```txt
.users[] | .name
```

**JMESPath** uses a wildcard projection that flows through the rest of the expression:

```txt
users[*].name
```

All three return `["Ada", "Grace", "Linus"]` (jq streams them one per line unless you wrap it). For simple extraction like this, they are equally convenient.

## "Get only the active users' names" (filtering)

This is where the differences show.

**JSONPath** uses a filter expression `?( … )`:

```txt
$.users[?(@.active == true)].name
```

**jq** uses `select()` inside the pipeline:

```txt
.users[] | select(.active) | .name
```

**JMESPath** uses a filter projection with `[?…]`:

```txt
users[?active].name
```

## "Compute the average age" (aggregation)

**jq** shines when you need to *transform* rather than just select:

```txt
(.users | map(.age) | add) / (.users | length)
```

JSONPath, by design, mostly *selects* values and leaves math to your host language — you would extract `$.users[*].age` and average them in code. JMESPath has some built-in functions (`length`, `max`, `sum` via `sum(users[].age)`) but is not a general computation language. If your task is heavy on reshaping, grouping, or arithmetic, jq is usually the answer.

## When to use which

- **Reach for JSONPath** when you want a quick, readable way to pluck values out of a document, especially inside another tool or a test assertion. It is now a formal standard (RFC 9535), widely implemented, and the shallow learning curve is its strength.
- **Reach for jq** when the task is real data engineering: filtering, mapping, grouping, computing, restructuring one shape into another. It is a small language, and that power is worth learning if you touch JSON on the command line often.
- **Reach for JMESPath** when you are already in its ecosystem — most notably the AWS CLI and SDKs use it for `--query` — or when you want deterministic, embeddable querying with a clean spec and multi-language libraries.

## Try all three on your own data

The fastest way to feel the differences is to run the same question three ways on data you actually care about. The [JSON query tool](/json-query) supports JSONPath, JMESPath, and jq side by side, entirely in your browser — paste a document, switch languages, and compare the results. Before you query, it often helps to [view the structure as a tree](/json-viewer) so you know exactly what paths exist. And if the document is not valid yet, [validate](/json-validator) it first — a query engine needs well-formed input.
