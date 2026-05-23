---
id: "semanticflow/project-api-modeling"
title: "Project and Third-Party API Modeling"
version: "1.0.0"
---

# Project and Third-Party API Modeling

Use this skill when modeling APIs from a real project, third-party SDK, or project wrapper.

## Source of Semantics

- Official/native semantics: HarmonyOS, OpenHarmony SDK, ArkUI, ArkTS, JavaScript, TypeScript, lifecycle, router, built-in storage, and built-in callbacks.
- Project/third-party semantics: project `ApiClient`, `Http`, `Logger`, `TokenManager`, `CookieManager`, database wrappers, business SDKs, and third-party SDK wrappers.
- Mixed semantics: split the bottom official API from the project wrapper. Do not turn project-private behavior into a universal kernel assumption.

## Modeling Rule

Model the API semantics only. Do not decide final source-to-sink reachability and do not write solver logic.

For project wrappers:

- If a wrapper sends an argument or field to network, log, storage, database, IPC, navigation, file, or system API and does not return that data, model it as a sink over the consumed input.
- If a wrapper returns data from an underlying source API or response object, model the visible output as a source or transfer, depending on whether the original input carries the payload.
- If a wrapper stores now and another API reads later, model it as a module, not as a direct one-surface rule.
- If the wrapper body, companion method, key, route, callback registration, or sink call is missing, ask for more evidence.

## Non-Goals

- Do not infer vulnerability existence.
- Do not promote temporary project candidates into formal assets.
- Do not create broad source/sink rules just to increase flow count.
- Do not model a status boolean as payload transfer unless the returned value actually contains the payload.
