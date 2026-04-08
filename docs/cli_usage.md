# ArkTaint CLI Usage

This document explains how to run ArkTaint from the command line.

If you want to extend ArkTaint instead:
- rules: [Rules](./rule_schema.md)
- modules: [Modules](./module_development_guide.md)
- plugins: [Plugins](./engine_plugin_guide.md)

## 1. Prerequisites

Run from the repository root:

```bash
npm install
npm run build
```

## 2. Minimal Command

```bash
node out/cli/analyze.js --repo <repo>
```

Example:

```bash
node out/cli/analyze.js --repo D:\projects\MyArkApp
```

If `--sourceDir` is omitted, ArkTaint tries these directories in order:

- `entry/src/main/ets`
- `src/main/ets`
- `.`

If auto-discovery fails, pass `--sourceDir` explicitly:

```bash
node out/cli/analyze.js --repo D:\projects\MyArkApp --sourceDir entry/src/main/ets
```

## 3. Common Commands

### 3.1 Analyze with builtin rules and builtin kernel modules

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules
```

### 3.2 Add a project rule file

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules \
  --project D:\projects\MyArkApp\arktaint.project.rules.json
```

### 3.3 Enable a project module group

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --module-root D:\projects\MyArkApp\arktaint_modules \
  --enable-module-project acme_sdk
```

### 3.4 Load external plugins and write plugin audit

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --plugins D:\projects\MyArkApp\arktaint_plugins \
  --plugin-audit
```

### 3.5 Enable LLM-based external entry recognition

Use this when the app may expose framework-managed callbacks or lifecycle-like entry methods that ArkMain cannot prove from official entry contracts alone.

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --ruleCatalog src/rules \
  --enableExternalEntryRecognition \
  --externalEntryModel gpt-4.1-mini \
  --externalEntryCachePath tmp\external_entry_cache.json \
  --enableExternalEntryFacts
```

Environment variables used by the hosted LLM client:

- `ARKTAINT_EXTERNAL_ENTRY_API_KEY`
  - falls back to `OPENAI_API_KEY`
- `ARKTAINT_EXTERNAL_ENTRY_BASE_URL`
  - falls back to `OPENAI_BASE_URL`, default `https://api.openai.com/v1`
- `ARKTAINT_EXTERNAL_ENTRY_MODEL`
  - falls back to `OPENAI_MODEL`
- `ARKTAINT_EXTERNAL_ENTRY_API_STYLE`
  - `auto`, `responses`, or `chat_completions`
- `ARKTAINT_EXTERNAL_ENTRY_HEADERS`
  - optional JSON object of extra HTTP headers

## 4. Output Layout

If `--outputDir` is omitted, ArkTaint writes to:

```text
output/runs/analyze/<repo-name>/<timestamp>/
```

Important artifacts:

- `run.json`
- `summary/summary.json`
- `summary/summary.md`
- `diagnostics/diagnostics.json`
- `diagnostics/diagnostics.txt`
- `audit/plugin_audit.json`
  - only when `--plugin-audit` is enabled

Explicit output directory:

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --outputDir tmp\analyze\my_project
```

## 5. Main Options

### 5.1 Basic Input

- `--repo <path>`
  - required
- `--sourceDir <dir[,dir]>`
  - one or more source directories
- `--outputDir <dir>`

### 5.2 Runtime Profile

- `--profile default|strict|fast`
- `--reportMode light|full`
- `--k 0|1`
- `--maxEntries <n>`
- `--concurrency <n>`

### 5.3 Incremental / Flow Control

- `--incremental`
- `--no-incremental`
- `--incrementalCache <path>`
- `--stopOnFirstFlow`
- `--no-stopOnFirstFlow`
- `--maxFlowsPerEntry <n>`
- `--secondarySinkSweep`
- `--no-secondarySinkSweep`

### 5.4 Rules

- `--kernelRule <file>`
- `--ruleCatalog <dir>`
- `--rules <dir>`
  - alias of `--ruleCatalog`
- `--project <file>`
- `--candidate <file>`
- `--enable-rule-pack <pack-id[,pack-id]>`
- `--disable-rule-pack <pack-id[,pack-id]>`

See [Rules](./rule_schema.md).

### 5.5 Modules

- `--module-root <dir[,dir]>`
- `--enable-module-project <project-id[,project-id]>`
- `--disable-module-project <project-id[,project-id]>`
- `--disable-module <module-id[,module-id]>`

Module inspection modes:

- `--list-module-projects`
- `--list-modules`
- `--explain-module <module-id>`
- `--trace-module <module-id>`

See [Modules](./module_development_guide.md).

### 5.6 Plugins

- `--plugins <dir-or-file[,dir-or-file]>`
- `--disable-plugins <plugin-name[,plugin-name]>`
- `--plugin-isolate <plugin-name[,plugin-name]>`
- `--plugin-dry-run`
- `--plugin-audit`

Plugin inspection modes:

- `--list-plugins`
- `--explain-plugin <plugin-name>`
- `--trace-plugin <plugin-name>`

See [Plugins](./engine_plugin_guide.md).

### 5.7 Inspection Mode Rule

Only one inspection mode may be used at a time:

- `--list-module-projects`
- `--list-modules`
- `--explain-module`
- `--trace-module`
- `--list-plugins`
- `--explain-plugin`
- `--trace-plugin`

Inspection modes still require `--repo`.

### 5.8 External Entry Recognition

- `--enableExternalEntryRecognition`
- `--externalEntryModel <model>`
- `--externalEntryMinConfidence <0..1>`
- `--externalEntryBatchSize <n>`
- `--externalEntryMaxCandidates <n>`
- `--externalEntryCachePath <path>`
- `--enableExternalEntryFacts`

## 6. Inspection Examples

### 6.1 List discovered module projects

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --module-root D:\projects\MyArkApp\arktaint_modules \
  --list-module-projects
```

### 6.2 List modules

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --module-root D:\projects\MyArkApp\arktaint_modules \
  --enable-module-project acme_sdk \
  --list-modules
```

### 6.3 Explain one module

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --module-root D:\projects\MyArkApp\arktaint_modules \
  --enable-module-project acme_sdk \
  --explain-module acme.upload_bridge
```

### 6.4 Trace one module during a real run

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --module-root D:\projects\MyArkApp\arktaint_modules \
  --enable-module-project acme_sdk \
  --trace-module acme.upload_bridge
```

### 6.5 List plugins

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --plugins D:\projects\MyArkApp\arktaint_plugins \
  --list-plugins
```

### 6.6 Explain one plugin

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --plugins D:\projects\MyArkApp\arktaint_plugins \
  --explain-plugin acme.pipeline_filter
```

### 6.7 Trace one plugin during a real run

```bash
node out/cli/analyze.js \
  --repo D:\projects\MyArkApp \
  --sourceDir entry/src/main/ets \
  --plugins D:\projects\MyArkApp\arktaint_plugins \
  --trace-plugin acme.pipeline_filter
```

## 7. Recommended Workflows

### 7.1 Rules only

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir <sourceDir> \
  --ruleCatalog src/rules
```

### 7.2 Rules plus project modules

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir <sourceDir> \
  --ruleCatalog src/rules \
  --project <project.rules.json> \
  --module-root <module-root> \
  --enable-module-project <project-id>
```

### 7.3 Plugins for pipeline extensions

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir <sourceDir> \
  --plugins <plugin-dir> \
  --plugin-audit
```

## 8. Common Errors

### `missing required --repo <path>`

You omitted `--repo`.

### `repo path not found: ...`

The repository path does not exist. Prefer an absolute path.

### `no sourceDir found. pass --sourceDir`

Automatic source discovery failed. Pass `--sourceDir` explicitly.

### inspection mode conflict

You passed more than one inspection mode.

### analysis runs but produces very few flows

Check in this order:

1. did the rules hit?
2. did the modules load?
3. did the traced module emit anything?
4. did a plugin alter the pipeline?

Useful commands:

- `--list-modules`
- `--explain-module`
- `--trace-module`
- `--list-plugins`
- `--explain-plugin`
- `--trace-plugin`
- `--plugin-audit`
