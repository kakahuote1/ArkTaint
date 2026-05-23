---
id: "semanticflow/evidence-and-safety"
title: "Evidence, Sanitizer, and Secret Safety"
version: "1.0.0"
---

# Evidence, Sanitizer, and Secret Safety

Use this skill to keep LLM-produced model assets conservative and auditable.

## Evidence Requirements

Every resolved candidate must identify:

- the API surface or call signature;
- the visible slot or module semantic being modeled;
- why the result belongs to `rule`, `module`, or `arkmain`;
- whether the semantics are official/native, project-level, or mixed;
- which evidence is still missing, if any.

If the current slice is incomplete, ask for one bounded evidence request. Do not force a resolved answer.

## Sanitizer Policy

Emit `ruleKind=sanitizer` only when the API has certain cleaning semantics for the relevant sink family.

Do not treat these as sanitizers by default:

- `toString`
- `substring`
- `JSON.stringify`
- formatting helpers
- encoding helpers
- validators such as `check`, `isValid`, `verify`, or `validate`
- logging or serialization wrappers

Weak or uncertain cleaning evidence belongs to postsolve/path evidence, not to a strong sanitizer rule.

## Safety

Never include credentials, API keys, environment variable values, local secret paths, raw full LLM responses, or copied secrets in rationale or generated artifacts.
Never output instructions to change ArkTaint solver code from the LLM modeling response.
