---
title: 'JSON vs YAML: differences and when to use each'
description: 'How JSON and YAML compare on syntax, comments, data types, and readability — the gotchas of each, and clear guidance on which format to reach for.'
publishDate: 2026-07-02
tags: ['Formats']
relatedTools:
  - name: JSON to YAML
    href: /json-to-yaml
    desc: Convert between the two formats instantly.
  - name: JSON Formatter
    href: /json-formatter
    desc: Clean up JSON before converting.
---

JSON and YAML are the two formats you meet most often for configuration and data interchange, and they are close cousins — in fact, every JSON document is also valid YAML. But they optimise for different things: JSON for unambiguous machine exchange, YAML for human-friendly configuration. Knowing where each shines (and where each bites) helps you pick well and avoid subtle bugs. When you need to move between them, the [JSON to YAML converter](/json-to-yaml) does it in your browser.

## The same data in both

**JSON:**

```json
{
  "service": "api",
  "replicas": 3,
  "ports": [80, 443],
  "env": { "LOG_LEVEL": "info" }
}
```

**YAML:**

```yaml
service: api
replicas: 3
ports:
  - 80
  - 443
env:
  LOG_LEVEL: info
```

Same structure, very different feel. JSON leans on explicit braces, brackets, and quotes; YAML uses indentation and dashes and drops most punctuation.

## Side-by-side comparison

| | JSON | YAML |
|---|---|---|
| Structure | Braces `{}` and brackets `[]` | Indentation and `-` list markers |
| Quotes | Required on all keys/strings | Usually optional |
| Comments | Not supported | `# like this` |
| Trailing commas | Forbidden | Not applicable |
| Readability | Good, but noisy for config | Excellent for config |
| Parsing ambiguity | Very low | Higher (see gotchas) |
| Superset relationship | — | A superset of JSON |

## Where JSON wins

- **Machine interchange and APIs.** JSON's rigidity is a feature: there is essentially one way to write a given value, so two systems rarely disagree about what it means. This is why it dominates HTTP APIs.
- **Ubiquity.** Every language parses JSON out of the box, often faster than YAML.
- **Safety.** With no comments, anchors, or type coercion, there is far less surface area for surprises.

## Where YAML wins

- **Human-edited configuration.** Kubernetes manifests, CI pipelines, and app config are pleasant to read and edit in YAML, largely because of indentation and **comments** — the single biggest thing JSON lacks for config.
- **Less punctuation noise.** Deeply nested config is easier to scan without stacks of closing braces.
- **Reuse.** YAML anchors and aliases let you define a block once and reference it, handy in large config files.

## YAML's gotchas (that JSON does not have)

YAML's friendliness comes at the cost of a few famous traps:

- **The "Norway problem".** Unquoted `NO`, `YES`, `ON`, `OFF`, `TRUE` can be coerced to booleans. A country-code list containing `NO` (Norway) can silently become `false`. Quote ambiguous strings.
- **Indentation sensitivity.** A single misaligned space changes the structure or breaks the parse. Tabs are not allowed for indentation.
- **Accidental numbers.** A value like `1.20` may lose its trailing zero; a version string like `1.10` can be read as the number `1.1`. Quote version numbers and IDs.
- **Multiple documents.** A single YAML file can contain several documents separated by `---`, which JSON cannot express.

JSON's stricter grammar means none of these ambiguities exist — what you write is what you get.

## Which should you use?

- **Use JSON** for data that crosses system boundaries: API requests and responses, message payloads, tokens, and anything a program writes for another program to read. Its predictability is exactly what you want when no human is in the loop.
- **Use YAML** for configuration that humans author and review, where comments and readability matter more than parsing speed — provided everyone editing it is aware of the gotchas above.

Many teams use both: YAML for the config a person maintains, JSON for the data the software exchanges.

## Converting between them

Because YAML is a superset of JSON, converting JSON to YAML is lossless, and converting well-behaved YAML back to JSON is straightforward. The [JSON to YAML converter](/json-to-yaml) handles both directions locally in your browser, so even config containing secrets stays on your machine. Tidy the JSON first with the [formatter](/json-formatter) if it is minified, and if you are weighing formats more broadly, the [what is JSON](/blog/what-is-json) guide covers JSON's data model in depth.
