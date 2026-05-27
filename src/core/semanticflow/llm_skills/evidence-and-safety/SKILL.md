---
id: "semanticflow/evidence-and-safety"
title: "Evidence, Sanitizer, and Secret Safety"
---

# Evidence, Sanitizer, and Secret Safety

Use this skill to keep generated assets conservative, auditable, and schema-valid.

## Evidence Requirements

Every `done` asset must be supported by code-slice evidence:

- the concrete surface being modeled;
- the role of each binding;
- the endpoint affected by each role;
- the effect template or facade relation referenced by the binding;
- whether the semantics are project/third-party, official/native, or mixed;
- evidence locations when available.

If a stable surface, role, endpoint, effect, relation, or wrapper transparency cannot be proven from the current slice, return `need-more-evidence`. Ask for exactly one bounded item, such as a companion method body, wrapper body, callback registration site, or specific endpoint evidence.

## Sanitizer Policy

Emit `rule.sanitizer` only for certain cleaning semantics for the relevant sink family.

Do not treat these as sanitizers by default:

- `toString`;
- `substring`;
- `JSON.stringify`;
- formatting helpers;
- encoding helpers;
- validators such as `check`, `isValid`, `verify`, or `validate`;
- logging or serialization wrappers.

Weak or uncertain cleaning evidence belongs to path/postsolve evidence, not to a strong sanitizer asset.

## Safety

Never include credentials, API keys, environment variable values, local secret paths, raw full LLM responses, or copied secrets in rationale or generated assets.

Never output instructions to change ArkTaint solver code. The LLM produces declarative assets only.

Never output `core.capability`. Core capabilities are reserved for built-in reviewed assets.
