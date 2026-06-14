const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DEFAULT_INVENTORY = "internal_docs/security_asset_iteration/official_api_semantic_inventory.json";
const DEFAULT_CLASS_REVIEW = "internal_docs/security_asset_iteration/official_api_class_semantic_review.json";
const DEFAULT_MANUAL_REVIEW = "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl";
const DEFAULT_OUT_DIR = "internal_docs/security_asset_iteration";

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function valueOf(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

const inventoryPath = valueOf("--inventory", DEFAULT_INVENTORY);
const classReviewPath = valueOf("--class-review", DEFAULT_CLASS_REVIEW);
const manualReviewPath = valueOf("--manual-review", DEFAULT_MANUAL_REVIEW);
const outDir = valueOf("--out-dir", DEFAULT_OUT_DIR);
const check = hasFlag("--check");
const strictComplete = hasFlag("--strict-complete");
const noWrite = hasFlag("--no-write");

function abs(file) {
  return path.resolve(ROOT, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function readJsonlIfExists(file) {
  const filePath = abs(file);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${error.message}`);
      }
    });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  fs.writeFileSync(abs(file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  fs.writeFileSync(abs(file), value, "utf8");
}

function toJsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function walk(dir, out = []) {
  const dirPath = abs(dir);
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const child = path.join(dirPath, entry.name);
    const rel = path.relative(ROOT, child).replace(/\\/g, "/");
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function contextKey(api) {
  return toArray(api.context).join(".");
}

function lastContext(api) {
  const ctx = toArray(api.context);
  return ctx.length > 0 ? String(ctx[ctx.length - 1]) : "";
}

function argCount(api) {
  return toArray(api.parameters).length;
}

function signatureKey(api) {
  return [
    api.file || "",
    contextKey(api),
    api.kind || "",
    api.name || "",
    String(api.line || ""),
    String(argCount(api)),
  ].join("#");
}

function csvEscape(value) {
  const s = Array.isArray(value) ? value.join(";") : value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const columns = [
    "signatureKey",
    "sdkFile",
    "line",
    "namespaceOrClass",
    "member",
    "kind",
    "argCount",
    "candidateFamily",
    "candidateRoles",
    "family",
    "roles",
    "manualReviewStatus",
    "manualReviewer",
    "manualReason",
    "capabilityFamily",
    "stateCellKind",
    "implementationStatus",
    "implementationArtifact",
    "testArtifact",
    "reviewDecision",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n") + "\n";
}

const FAMILY_CAPABILITY = {
  "account-credential": "harmony.security_account",
  "arkmain-entry": "harmony.arkmain",
  "arkui-display-sink": "harmony.arkui_component_state",
  "arkui-input-source": "harmony.arkui_component_state",
  "device-env-context": "harmony.device_context",
  "file-uri-source-sink": "harmony.file_uri",
  "ipc-event-message": "harmony.ipc_event_message",
  "log-sink": "harmony.official_log",
  "media-camera-av-source-sink": "harmony.media_display",
  "navigation-ability-handoff": "harmony.router_ability",
  "network-source-sink": "harmony.network_request",
  "notification-form-kv": "harmony.notification_form",
  "pasteboard-unifieddata": "harmony.clipboard_unifieddata",
  "preferences-state": "harmony.keyed_storage",
  "rdb-datashare-state-sql": "harmony.rdb_datashare",
  "security-crypto-sensitive": "harmony.security_account",
  "webview-bridge-source-sink": "harmony.webview_bridge",
};

const FAMILY_CELL = {
  "account-credential": "security-credential-slot",
  "arkmain-entry": "framework-entry-slot",
  "arkui-display-sink": "ui-display-slot",
  "arkui-input-source": "value",
  "device-env-context": "system-context-slot",
  "file-uri-source-sink": "file-content-slot",
  "ipc-event-message": "event-payload-slot",
  "log-sink": "value",
  "media-camera-av-source-sink": "media-source-slot",
  "navigation-ability-handoff": "navigation-param-slot",
  "network-source-sink": "network-request-slot",
  "notification-form-kv": "global-context-slot",
  "pasteboard-unifieddata": "system-pasteboard-slot",
  "preferences-state": "keyed-semantic-slot",
  "rdb-datashare-state-sql": "database-table-slot",
  "security-crypto-sensitive": "security-asset-slot",
  "webview-bridge-source-sink": "webview-resource-slot",
};

const FAMILY_TESTS = {
  "account-credential": ["test:source-exact", "test:sink-exact"],
  "arkmain-entry": ["test:entry-model:arkmain-core", "test:arkmain-assets-v2-schema"],
  "arkui-display-sink": ["test:official-form-ui-asset-coverage", "test:framework-sink-family-contract"],
  "arkui-input-source": ["test:framework-callback-source-family-contract", "test:framework-source-exactness-gate"],
  "device-env-context": ["test:framework-api-source-family-contract"],
  "file-uri-source-sink": ["test:official-kv-picker-asset-coverage", "test:source-exact", "test:sink-exact"],
  "ipc-event-message": ["test:official-module-semantic-slots", "test:module-assets-v2-schema"],
  "log-sink": ["test:framework-sink-family-contract", "test:sink-exact"],
  "media-camera-av-source-sink": ["test:official-module-semantic-slots", "test:framework-sink-family-contract"],
  "navigation-ability-handoff": ["test:official-module-semantic-slots", "test:harmony-router-bridge"],
  "network-source-sink": ["test:framework-api-source-family-contract", "test:framework-sink-family-contract"],
  "notification-form-kv": ["test:official-form-ui-asset-coverage", "test:official-module-semantic-slots"],
  "pasteboard-unifieddata": ["test:official-module-semantic-slots"],
  "preferences-state": ["test:official-kv-picker-asset-coverage", "test:official-module-semantic-slots"],
  "rdb-datashare-state-sql": ["test:official-module-semantic-slots", "test:transfer-exact"],
  "security-crypto-sensitive": ["test:official-module-semantic-slots", "test:sink-exact"],
  "webview-bridge-source-sink": ["test:official-module-semantic-slots", "test:framework-sink-family-contract"],
};

const GENERIC_HANDOFF_EFFECT_CONSUMERS = [
  "src/core/orchestration/modules/InternalModuleLoweringIRSemanticCompiler.ts",
  "src/core/kernel/semantic_handoff/SemanticHandoffPropagation.ts",
];

const CONSUMER_FILES = {
  "harmony.arkmain": [],
  "harmony.network_request": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.webview_bridge": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.keyed_storage": [
    "src/core/orchestration/modules/harmony_semantics/appstorage.ts",
    ...GENERIC_HANDOFF_EFFECT_CONSUMERS,
  ],
  "harmony.preferences_state": [
    "src/core/orchestration/modules/harmony_semantics/appstorage.ts",
    ...GENERIC_HANDOFF_EFFECT_CONSUMERS,
  ],
  "harmony.rdb_datashare": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_resultset": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_handle": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_query": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_write": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_kill": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_predicates": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_raw_sql_query": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_sync": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_execute": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_backup": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_restore_attach": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_remote_query": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.rdb_security_config": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.datashare_template_sql": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.datashare_publish": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.router_ability": [
    "src/core/orchestration/modules/harmony_semantics/router.ts",
    "src/core/orchestration/modules/harmony_semantics/ability_handoff.ts",
  ],
  "harmony.ipc_event_message": ["src/core/orchestration/modules/harmony_semantics/emitter.ts"],
  "harmony.file_uri": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.clipboard_unifieddata": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.media_display": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.arkui_component_state": [
    "src/core/orchestration/modules/harmony_semantics/state.ts",
    ...GENERIC_HANDOFF_EFFECT_CONSUMERS,
  ],
  "harmony.security_account": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.device_context": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.notification_form": GENERIC_HANDOFF_EFFECT_CONSUMERS,
  "harmony.official_log": [],
};

function readKernelRuleAssets() {
  const files = walk("src/models/kernel/rules").filter((file) => file.endsWith(".json"));
  const entries = [];
  const broadMatchers = [];
  for (const file of files) {
    const json = readJson(file);
    const surfaces = toArray(json.surfaces);
    const surfaceById = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));
    for (const binding of toArray(json.bindings)) {
      const surface = surfaceById.get(binding.surfaceId) || {};
      const selector = binding.selector || {};
      const isFreeFunction = surface.invokeKind === "free-function" || selector.invokeKind === "free-function";
      const surfaceOwner = isFreeFunction
        ? ""
        : surface.ownerName || surface.className || selector.typeHint || "";
      const surfaceMember = surface.methodName || surface.functionName || surface.className || surface.propertyName || selector.value || "";
      const surfaceArgCount = typeof surface.argCount === "number" ? surface.argCount : selector.argCount;
      entries.push({
        file,
        assetId: json.id || "",
        bindingId: binding.bindingId || "",
        role: binding.role || "",
        ownerName: surfaceOwner,
        methodName: surfaceMember,
        modulePath: surface.modulePath || "",
        argCount: surfaceArgCount,
      });
      const reasons = [];
      if (selector.kind && String(selector.kind).includes("contains")) reasons.push(`selector.kind=${selector.kind}`);
      if (selector.kind && String(selector.kind).includes("regex")) reasons.push(`selector.kind=${selector.kind}`);
      if (selector.calleeScope) {
        for (const [scopeKey, scopeValue] of Object.entries(selector.calleeScope)) {
          if (scopeValue && typeof scopeValue === "object" && scopeValue.mode === "contains") {
            reasons.push(`calleeScope.${scopeKey}.contains`);
          }
        }
      }
      if (reasons.length > 0) {
        broadMatchers.push({ file, assetId: json.id || "", bindingId: binding.bindingId || "", reasons });
      }
    }
  }
  return { entries, broadMatchers };
}

function readModuleArtifacts() {
  return walk("src/models/kernel/modules")
    .filter((file) => file.endsWith(".ts"))
    .map((file) => {
      const text = fs.readFileSync(abs(file), "utf8");
      return { file, text };
    });
}

function readArkMainArtifacts() {
  return walk("src/models/kernel/arkmain")
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const text = fs.readFileSync(abs(file), "utf8");
      return { file, text };
    });
}

function readCatalogText() {
  return [
    "src/core/rules/FrameworkApiSourceCatalog.ts",
    "src/core/rules/FrameworkCallbackSourceCatalog.ts",
    "src/core/rules/FrameworkSinkCatalog.ts",
    "src/core/rules/FrameworkSanitizerCatalog.ts",
  ]
    .filter((file) => fs.existsSync(abs(file)))
    .map((file) => ({ file, text: fs.readFileSync(abs(file), "utf8") }));
}

function methodMatchesEntry(api, entry) {
  if (!entry.methodName || entry.methodName !== api.name) return false;
  const owner = lastContext(api);
  const ctx = contextKey(api);
  const ownerMatches = !entry.ownerName || entry.ownerName === owner || ctx.endsWith(`.${entry.ownerName}`) || ctx === entry.ownerName;
  const argMatches = entry.argCount == null || Number(entry.argCount) === argCount(api);
  return ownerMatches && argMatches;
}

function ruleMatches(api, role, ruleEntries, catalogText) {
  const direct = ruleEntries
    .filter((entry) => entry.role === role && methodMatchesEntry(api, entry))
    .map((entry) => `${entry.file}:${entry.bindingId || entry.assetId}`);
  if (direct.length > 0) return direct;
  const member = api.name || "";
  const owner = lastContext(api);
  if (!member) return [];
  return catalogText
    .filter((catalog) => catalog.text.includes(member) && (!owner || catalog.text.includes(owner) || catalog.text.includes(contextKey(api))))
    .map((catalog) => catalog.file);
}

function transferMatches(api, ruleEntries) {
  return ruleEntries
    .filter((entry) => entry.role === "transfer" && methodMatchesEntry(api, entry))
    .map((entry) => `${entry.file}:${entry.bindingId || entry.assetId}`);
}

function sanitizerMatches(api, ruleEntries) {
  return ruleEntries
    .filter((entry) => entry.role === "sanitizer" && methodMatchesEntry(api, entry))
    .map((entry) => `${entry.file}:${entry.bindingId || entry.assetId}`);
}

function moduleMatches(api, moduleArtifacts) {
  const member = api.name || "";
  const owner = lastContext(api);
  if (!member) return [];
  return moduleArtifacts
    .filter((artifact) => {
      const methodMatch = api.kind === "constructor"
        ? true
        : artifact.text.includes(`"${member}"`)
          || artifact.text.includes(`'${member}'`)
          || artifact.text.includes(`methodName: ${member}`);
      if (!methodMatch) return false;
      return !owner || artifact.text.includes(`"${owner}"`) || artifact.text.includes(`'${owner}'`) || artifact.text.includes(contextKey(api));
    })
    .map((artifact) => artifact.file);
}

function arkMainMatches(api, arkMainArtifacts) {
  const member = api.name || "";
  if (!member) return [];
  const matches = [];
  for (const artifact of arkMainArtifacts) {
    try {
      const json = readJson(artifact.file);
      const payloadText = JSON.stringify(toArray(json.effectTemplates).map((template) => template.payload || {}));
      if (payloadText.includes(`"${member}"`)) matches.push(artifact.file);
    } catch {
      if (artifact.text.includes(`"${member}"`) || artifact.text.includes(`'${member}'`)) matches.push(artifact.file);
    }
  }
  return matches;
}

function roleBucket(roles) {
  const set = new Set(roles);
  return {
    source: set.has("source"),
    sink: set.has("sink") || set.has("display-sink"),
    transfer: set.has("transform") || set.has("transfer"),
    module: set.has("load") || set.has("store") || set.has("kill") || set.has("handoff") || set.has("handle"),
    sanitizer: set.has("sanitizer"),
    arkmain: set.has("arkmain") || set.has("arkmain-entry") || set.has("entry"),
    excluded: set.has("excluded"),
  };
}

function propertyAccessCoreMatches(api, roles) {
  if (api.kind !== "property") return [];
  const set = new Set(roles);
  const needsAccessCore = set.has("load")
    || set.has("store")
    || set.has("handle")
    || set.has("kill")
    || set.has("handoff");
  if (!needsAccessCore) return [];
  return [
    "src/core/rules/RuleAssetLowering.ts",
    "src/core/kernel/ordinary/OrdinaryLanguagePropagation.ts",
    "src/core/kernel/oclfs/OclfsSolver.ts",
  ].filter((file) => fs.existsSync(abs(file)));
}

function noPayloadModuleSinkCanSatisfy(api, roles) {
  if (!toArray(roles).includes("sink")) return false;
  if (api.kind !== "function") return false;
  return argCount(api) === 0;
}

function decideImplementation(api, roles, capabilityFamily, assets) {
  const bucket = roleBucket(roles);
  if (bucket.excluded) {
    return {
      implementationStatus: "excluded",
      implementationArtifact: ["manual-review:excluded"],
      reviewDecision: "Human reviewer excluded this declaration from taint semantics.",
    };
  }

  const artifacts = new Set();
  const expected = [];
  const satisfied = [];

  if (bucket.source) {
    expected.push("source");
    for (const match of ruleMatches(api, "source", assets.ruleEntries, assets.catalogText)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("sources") || item.includes("FrameworkApiSource") || item.includes("FrameworkCallbackSource"))) satisfied.push("source");
  }
  if (bucket.sink) {
    expected.push("sink");
    for (const match of ruleMatches(api, "sink", assets.ruleEntries, assets.catalogText)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("sinks") || item.includes("FrameworkSink"))) satisfied.push("sink");
  }
  if (bucket.transfer) {
    expected.push("transfer");
    for (const match of transferMatches(api, assets.ruleEntries)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("transfers"))) satisfied.push("transfer");
  }
  if (bucket.sanitizer) {
    expected.push("sanitizer");
    for (const match of sanitizerMatches(api, assets.ruleEntries)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("sanitizers") || item.includes("FrameworkSanitizer"))) satisfied.push("sanitizer");
  }
  if (bucket.module) {
    expected.push("module");
    for (const match of moduleMatches(api, assets.moduleArtifacts)) artifacts.add(match);
    for (const match of propertyAccessCoreMatches(api, roles)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("src/models/kernel/modules"))) satisfied.push("module");
    else if (propertyAccessCoreMatches(api, roles).length > 0) satisfied.push("module");
  }
  if (bucket.sink && bucket.module && noPayloadModuleSinkCanSatisfy(api, roles) && satisfied.includes("module")) {
    satisfied.push("sink");
  }
  if (bucket.arkmain) {
    expected.push("arkmain");
    for (const match of arkMainMatches(api, assets.arkMainArtifacts)) artifacts.add(match);
    if (Array.from(artifacts).some((item) => item.includes("src/models/kernel/arkmain"))) satisfied.push("arkmain");
  }

  const consumers = toArray(CONSUMER_FILES[capabilityFamily]).filter((file) => fs.existsSync(abs(file)));
  for (const consumer of consumers) artifacts.add(consumer);

  if (expected.length === 0) {
    return {
      implementationStatus: "missing",
      implementationArtifact: [],
      reviewDecision: `Human-confirmed roles did not map to an implementation expectation: ${roles.join(",")}.`,
    };
  }

  const uniqueSatisfied = new Set(satisfied);
  let status = "missing";
  if (uniqueSatisfied.size === expected.length) status = "implemented";
  else if (uniqueSatisfied.size > 0) status = "partial";

  if (bucket.module && uniqueSatisfied.has("module") && consumers.length === 0) status = "consumer-gap";

  return {
    implementationStatus: status,
    implementationArtifact: Array.from(artifacts).sort(),
    reviewDecision: status === "missing"
      ? `No exact current kernel artifact matched expected ${expected.join(", ")}.`
      : `Matched ${Array.from(uniqueSatisfied).join(", ")} of expected ${expected.join(", ")}.`,
  };
}

function manualReviewMap(records) {
  const map = new Map();
  const duplicates = [];
  const validStatuses = new Set(["confirmed", "excluded", "deferred"]);
  for (const record of records) {
    if (!record.signatureKey) continue;
    if (map.has(record.signatureKey)) duplicates.push(record.signatureKey);
    if (!validStatuses.has(record.status)) throw new Error(`manual review ${record.signatureKey}: invalid status ${record.status}`);
    map.set(record.signatureKey, record);
  }
  return { map, duplicates };
}

function applyManualDecision(api, candidateFamily, candidateRoles, review) {
  if (!review) {
    return {
      manualReviewStatus: "needs_manual_review",
      family: candidateFamily,
      roles: ["needs_manual_review"],
      capabilityFamily: FAMILY_CAPABILITY[candidateFamily] || "needs_manual_review",
      stateCellKind: FAMILY_CELL[candidateFamily] || "",
      manualReviewer: "",
      manualReason: "No human declaration-level review record.",
    };
  }
  if (review.status === "excluded") {
    const family = review.family || candidateFamily;
    return {
      manualReviewStatus: "excluded",
      family,
      roles: ["excluded"],
      capabilityFamily: review.capabilityFamily || FAMILY_CAPABILITY[family] || "excluded",
      stateCellKind: review.stateCellKind || FAMILY_CELL[family] || "",
      manualReviewer: review.reviewer || "",
      manualReason: review.reason || "Human reviewer excluded this official declaration.",
    };
  }
  if (review.status === "deferred") {
    const family = review.family || candidateFamily;
    return {
      manualReviewStatus: "deferred",
      family,
      roles: ["deferred"],
      capabilityFamily: review.capabilityFamily || FAMILY_CAPABILITY[family] || "deferred",
      stateCellKind: review.stateCellKind || FAMILY_CELL[family] || "",
      manualReviewer: review.reviewer || "",
      manualReason: review.reason || "Human reviewer deferred this official declaration.",
    };
  }
  const roles = toArray(review.roles);
  if (roles.length === 0) throw new Error(`manual review ${signatureKey(api)}: confirmed record must provide roles`);
  const family = review.family || candidateFamily;
  return {
    manualReviewStatus: "confirmed",
    family,
    roles,
    capabilityFamily: review.capabilityFamily || FAMILY_CAPABILITY[family] || "unclassified",
    stateCellKind: review.stateCellKind || FAMILY_CELL[family] || "",
    manualReviewer: review.reviewer || "",
    manualReason: review.reason || "Human reviewer confirmed this declaration.",
  };
}

function summarize(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key] || "", (counts.get(row[key] || "") || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function summarizeByFamilyStatus(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.family}::${row.implementationStatus}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => {
      const [family, status] = key.split("::");
      return { family, status, count };
    })
    .sort((a, b) => a.family.localeCompare(b.family) || a.status.localeCompare(b.status));
}

function officialAssetSummary(assets) {
  const roleCounts = {};
  for (const entry of assets.ruleEntries) {
    const role = entry.role || "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const arkmainBindings = [];
  for (const artifact of assets.arkMainArtifacts) {
    try {
      const json = readJson(artifact.file);
      for (const binding of toArray(json.bindings)) {
        arkmainBindings.push({
          file: artifact.file,
          assetId: json.id || "",
          bindingId: binding.bindingId || "",
          role: binding.role || "",
        });
      }
    } catch {
      // The artifact text is still available for matching; malformed JSON is reported elsewhere by normal parsing.
    }
  }
  return {
    ruleRoleCounts: roleCounts,
    sanitizerBindingCount: roleCounts.sanitizer || 0,
    arkmainAssetCount: assets.arkMainArtifacts.length,
    arkmainBindingCount: arkmainBindings.length,
    moduleArtifactCount: assets.moduleArtifacts.length,
  };
}

function markdownTable(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${headers.map((header) => String(row[header] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return lines.join("\n");
}

function buildReport({ rows, inventory, classReview, gate }) {
  const byStatus = summarize(rows, "implementationStatus").map(([status, count]) => ({ status, count }));
  const byManualStatus = summarize(rows, "manualReviewStatus").map(([status, count]) => ({ status, count }));
  const byFamilyStatus = summarizeByFamilyStatus(rows);
  const officialRuleRows = Object.entries(gate.officialAssets.ruleRoleCounts || {})
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => a.role.localeCompare(b.role));
  const consumerRows = Array.from(rows
    .filter((row) => row.implementationStatus === "consumer-gap")
    .reduce((map, row) => map.set(row.capabilityFamily, (map.get(row.capabilityFamily) || 0) + 1), new Map())
    .entries())
    .map(([consumer, count]) => ({ consumer, count }))
    .sort((a, b) => b.count - a.count);
  const remainingRows = byFamilyStatus
    .filter((row) => ["needs_manual_review", "deferred", "missing", "partial", "consumer-gap"].includes(row.status))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);

  return [
    "# Official API Declaration Coverage Gate Report",
    "",
    "This report is generated from the SDK inventory plus the manual review overlay.",
    "The script does not decide official API semantics. It records SDK evidence and checks human-confirmed decisions for rule assets (source/sink/transfer/sanitizer), ArkMain assets, and module assets plus consumers.",
    "",
    "## Inputs",
    "",
    markdownTable(["item", "value"], [
      { item: "inventory", value: inventoryPath },
      { item: "class review", value: classReviewPath },
      { item: "manual review", value: manualReviewPath },
      { item: "API declarations", value: inventory.summary && inventory.summary.apiDeclarations || inventory.apis.length },
      { item: "semantic declarations in ledger", value: rows.length },
      { item: "class summaries", value: classReview.classSummaries ? classReview.classSummaries.length : "unknown" },
    ]),
    "",
    "## Gate Result",
    "",
    markdownTable(["check", "value"], [
      { check: "duplicate signature keys", value: gate.duplicateSignatureKeys.length },
      { check: "duplicate manual review keys", value: gate.duplicateManualReviewKeys.length },
      { check: "unclassified semantic declarations", value: gate.unclassified.length },
      { check: "needs manual review", value: gate.needsManualReview.length },
      { check: "deferred manual decisions", value: gate.deferredManualReview.length },
      { check: "implemented without artifact", value: gate.implementedWithoutArtifact.length },
      { check: "kernel JSON broad matchers", value: gate.broadMatchers.length },
      { check: "strict complete", value: gate.strictCompletePassed ? "PASS" : "FAIL" },
    ]),
    "",
    "## Manual Review Status",
    "",
    markdownTable(["status", "count"], byManualStatus),
    "",
    "## Implementation Status",
    "",
    markdownTable(["status", "count"], byStatus),
    "",
    "## Current Official Asset Plane Inventory",
    "",
    "This section counts the currently loaded official kernel assets. It is a sanity inventory, not a declaration-level semantic decision.",
    "",
    "### Rule Asset Roles",
    "",
    officialRuleRows.length > 0 ? markdownTable(["role", "count"], officialRuleRows) : "None.",
    "",
    "### ArkMain And Module Assets",
    "",
    markdownTable(["asset plane", "count"], [
      { "asset plane": "rule sanitizer bindings", count: gate.officialAssets.sanitizerBindingCount },
      { "asset plane": "arkmain asset files", count: gate.officialAssets.arkmainAssetCount },
      { "asset plane": "arkmain bindings", count: gate.officialAssets.arkmainBindingCount },
      { "asset plane": "module asset files", count: gate.officialAssets.moduleArtifactCount },
    ]),
    "",
    "## Family / Status",
    "",
    markdownTable(["family", "status", "count"], byFamilyStatus),
    "",
    "## Consumer Gaps",
    "",
    consumerRows.length > 0 ? markdownTable(["consumer", "count"], consumerRows) : "None.",
    "",
    "## Main Remaining Work",
    "",
    remainingRows.length > 0 ? markdownTable(["family", "status", "count"], remainingRows) : "None.",
    "",
    "## Gate Failure Details",
    "",
    "### Needs Manual Review",
    "",
    gate.needsManualReview.length > 0 ? gate.needsManualReview.slice(0, 120).map((row) => `- ${row.signatureKey}`).join("\n") : "None.",
    "",
    "### Unclassified",
    "",
    gate.unclassified.length > 0 ? gate.unclassified.slice(0, 80).map((row) => `- ${row.signatureKey}`).join("\n") : "None.",
    "",
    "### Implemented Without Artifact",
    "",
    gate.implementedWithoutArtifact.length > 0 ? gate.implementedWithoutArtifact.slice(0, 80).map((row) => `- ${row.signatureKey}`).join("\n") : "None.",
    "",
    "### Kernel JSON Broad Matchers",
    "",
    gate.broadMatchers.length > 0 ? gate.broadMatchers.slice(0, 80).map((row) => `- ${row.file} ${row.bindingId}: ${row.reasons.join("; ")}`).join("\n") : "None.",
    "",
    "## Conclusion",
    "",
    gate.strictCompletePassed
      ? "Strict complete passed: every human-reviewed declaration is implemented or excluded."
      : "Strict complete failed: manual declaration-level review and/or implementation coverage is incomplete.",
    "",
  ].join("\n");
}

function main() {
  const inventory = readJson(inventoryPath);
  const classReview = readJson(classReviewPath);
  const { map: manualReviews, duplicates: duplicateManualReviewKeys } = manualReviewMap(readJsonlIfExists(manualReviewPath));
  const { entries: ruleEntries, broadMatchers } = readKernelRuleAssets();
  const assets = {
    ruleEntries,
    broadMatchers,
    moduleArtifacts: readModuleArtifacts(),
    arkMainArtifacts: readArkMainArtifacts(),
    catalogText: readCatalogText(),
  };

  const semanticApis = toArray(inventory.apis).filter((api) => {
    const sem = api.semantic || {};
    return sem.family && sem.family !== "not-taint-relevant";
  });

  const rows = semanticApis.map((api) => {
    const sem = api.semantic || {};
    const candidateRoles = toArray(sem.roles).length > 0 ? toArray(sem.roles) : ["unclassified"];
    const candidateFamily = sem.family || "unclassified";
    const key = signatureKey(api);
    const manual = applyManualDecision(api, candidateFamily, candidateRoles, manualReviews.get(key));
    const implementation = manual.manualReviewStatus === "confirmed"
      ? decideImplementation(api, manual.roles, manual.capabilityFamily, assets)
      : {
          implementationStatus: manual.manualReviewStatus === "excluded" ? "excluded" : manual.manualReviewStatus,
          implementationArtifact: [],
          reviewDecision: manual.manualReason,
        };
    const tests = FAMILY_TESTS[manual.family] || ["test:official-api-coverage-gate"];
    return {
      signatureKey: key,
      sdkFile: api.file || "",
      line: api.line || "",
      namespaceOrClass: contextKey(api),
      member: api.name || "",
      kind: api.kind || "",
      argCount: argCount(api),
      candidateFamily,
      candidateRoles,
      family: manual.family,
      roles: manual.roles,
      manualReviewStatus: manual.manualReviewStatus,
      manualReviewer: manual.manualReviewer,
      manualReason: manual.manualReason,
      capabilityFamily: manual.capabilityFamily,
      stateCellKind: manual.stateCellKind,
      implementationStatus: implementation.implementationStatus,
      implementationArtifact: implementation.implementationArtifact,
      testArtifact: tests,
      reviewDecision: `Candidate: ${sem.reason || "inventory classification"}. Manual: ${manual.manualReason}. Implementation: ${implementation.reviewDecision}`,
    };
  });

  const seen = new Map();
  for (const row of rows) seen.set(row.signatureKey, (seen.get(row.signatureKey) || 0) + 1);
  const duplicateSignatureKeys = Array.from(seen.entries()).filter(([, count]) => count > 1).map(([key]) => key);
  const unclassified = rows.filter((row) => row.family === "unclassified" || row.roles.includes("unclassified") || row.capabilityFamily === "unclassified");
  const needsManualReview = rows.filter((row) => row.manualReviewStatus === "needs_manual_review");
  const deferredManualReview = rows.filter((row) => row.manualReviewStatus === "deferred");
  const implementedWithoutArtifact = rows.filter((row) => row.implementationStatus === "implemented" && toArray(row.implementationArtifact).length === 0);
  const strictCompletePassed = rows.every((row) => row.implementationStatus === "implemented" || row.implementationStatus === "excluded");
  const officialAssets = officialAssetSummary(assets);
  const gate = {
    duplicateSignatureKeys,
    duplicateManualReviewKeys,
    unclassified,
    needsManualReview,
    deferredManualReview,
    implementedWithoutArtifact,
    broadMatchers,
    officialAssets,
    strictCompletePassed,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: { inventoryPath, classReviewPath, manualReviewPath },
    summary: {
      totalInventoryApis: toArray(inventory.apis).length,
      semanticLedgerRows: rows.length,
      classSummaries: toArray(classReview.classSummaries).length,
      manualReviewStatuses: Object.fromEntries(summarize(rows, "manualReviewStatus")),
      statuses: Object.fromEntries(summarize(rows, "implementationStatus")),
      duplicateSignatureKeys: duplicateSignatureKeys.length,
      duplicateManualReviewKeys: duplicateManualReviewKeys.length,
      unclassified: unclassified.length,
      needsManualReview: needsManualReview.length,
      deferredManualReview: deferredManualReview.length,
      implementedWithoutArtifact: implementedWithoutArtifact.length,
      broadMatchers: broadMatchers.length,
      officialAssets,
      strictCompletePassed,
    },
    rows,
  };
  const manualReviewQueue = needsManualReview.map((row) => ({
    signatureKey: row.signatureKey,
    sdkFile: row.sdkFile,
    line: row.line,
    namespaceOrClass: row.namespaceOrClass,
    member: row.member,
    kind: row.kind,
    argCount: row.argCount,
    candidateFamily: row.candidateFamily,
    candidateRoles: row.candidateRoles,
    requiredDecision: "Write one manual review record with status confirmed, excluded, or deferred. Do not copy this queue row as the final review decision.",
  }));

  const ledgerJson = path.join(outDir, "official_api_declaration_coverage_ledger.json").replace(/\\/g, "/");
  const ledgerCsv = path.join(outDir, "official_api_declaration_coverage_ledger.csv").replace(/\\/g, "/");
  const reportMd = path.join(outDir, "official_api_coverage_gate_report.md").replace(/\\/g, "/");
  const reviewQueueJsonl = path.join(outDir, "official_api_declaration_manual_review_queue.jsonl").replace(/\\/g, "/");

  if (!noWrite) {
    writeJson(ledgerJson, output);
    writeText(ledgerCsv, toCsv(rows));
    writeText(reportMd, buildReport({ rows, inventory, classReview, gate }));
    writeText(reviewQueueJsonl, toJsonl(manualReviewQueue));
  }

  const failing = [];
  if (duplicateSignatureKeys.length > 0) failing.push(`duplicate signature keys=${duplicateSignatureKeys.length}`);
  if (duplicateManualReviewKeys.length > 0) failing.push(`duplicate manual review keys=${duplicateManualReviewKeys.length}`);
  if (unclassified.length > 0) failing.push(`unclassified=${unclassified.length}`);
  if (needsManualReview.length > 0) failing.push(`needs manual review=${needsManualReview.length}`);
  if (implementedWithoutArtifact.length > 0) failing.push(`implemented without artifact=${implementedWithoutArtifact.length}`);
  if (broadMatchers.length > 0) failing.push(`kernel JSON broad matchers=${broadMatchers.length}`);
  if (strictComplete && !strictCompletePassed) failing.push("strict complete failed");

  console.log(`official_api_coverage ledger_rows=${rows.length} semantic_apis=${semanticApis.length} strict=${strictCompletePassed ? "PASS" : "FAIL"}`);
  console.log(`manualReviewStatuses=${JSON.stringify(output.summary.manualReviewStatuses)}`);
  console.log(`statuses=${JSON.stringify(output.summary.statuses)}`);
  if (!noWrite) console.log(`wrote ${ledgerJson}, ${ledgerCsv}, ${reportMd}, ${reviewQueueJsonl}`);

  if (check && failing.length > 0) {
    console.error(`OFFICIAL_API_COVERAGE_GATE_FAILED ${failing.join("; ")}`);
    process.exit(1);
  }
}

main();
