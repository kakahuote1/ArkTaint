const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const INVENTORY = "internal_docs/security_asset_iteration/official_api_semantic_inventory.json";
const LEDGER = "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json";

function abs(file) {
  return path.resolve(ROOT, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  fs.writeFileSync(abs(file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  fs.writeFileSync(abs(file), value, "utf8");
}

function removeIfExists(file) {
  const filePath = abs(file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function hash(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
}

function apiKey(api) {
  return [
    api.file || "",
    (api.context || []).join("."),
    api.kind || "",
    api.name || "",
    String(api.line || ""),
    String((api.parameters || []).length),
  ].join("#");
}

function safePart(value) {
  return String(value || "api")
    .replace(/[^A-Za-z0-9_.-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "api";
}

function cleanFamily(value) {
  return safePart(value).toLowerCase();
}

function isCallbackParam(param) {
  const text = `${param?.name || ""} ${param?.type || ""}`.toLowerCase();
  return text.includes("callback") || text.includes("listener") || text.includes("=>");
}

function returnsPromise(api) {
  return String(api.returnType || "").toLowerCase().includes("promise<");
}

function returnsVoid(api) {
  return !api.returnType || String(api.returnType).trim().toLowerCase() === "void";
}

function arg(index, accessPath) {
  const out = { base: { kind: "arg", index } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function receiver(accessPath) {
  const out = { base: { kind: "receiver" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function ret(accessPath) {
  const out = { base: { kind: "return" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function promiseResult(accessPath) {
  const out = { base: { kind: "promiseResult" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function callbackArg(callbackIndex, argIndex, accessPath) {
  const out = {
    base: {
      kind: "callbackArg",
      callback: { kind: "arg", index: callbackIndex },
      argIndex,
    },
  };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function endpointForResult(api) {
  if (returnsPromise(api)) return promiseResult();
  return ret();
}

function nonCallbackArgIndexes(api) {
  return (api.parameters || [])
    .map((param, index) => ({ param, index }))
    .filter(({ param }) => !isCallbackParam(param))
    .map(({ index }) => index);
}

const PAYLOAD_NAME = /(value|values|data|content|text|message|msg|body|header|headers|url|uri|src|path|paths|file|files|token|password|passwd|secret|credential|key|want|params?|query|sql|statement|predicate|predicates|columns|table|record|bucket|options|request|config|entry|item|image|buffer|input|payload|resource|title|description|label|address|name|mime|extension|typeid)/i;
const LOW_VALUE_NAME = /^(callback|listener|context|abilitycontext|session|progress|success|fail|complete|error|err|index|offset|length|size|width|height|x|y|z|left|right|top|bottom|duration|timeout|mode|flag|flags|level|style|color|font|scale|ratio)$/i;

function selectedPayloadArgIndexes(api, family, role) {
  const params = api.parameters || [];
  const candidates = [];
  for (const [index, param] of params.entries()) {
    if (isCallbackParam(param)) continue;
    const name = String(param.name || "");
    const type = String(param.type || "");
    const text = `${name} ${type}`;
    if (LOW_VALUE_NAME.test(name) && !/token|password|secret|credential|key/i.test(name)) continue;
    if (PAYLOAD_NAME.test(text)) candidates.push(index);
  }
  if (candidates.length > 0) return candidates;
  const nonCallback = nonCallbackArgIndexes(api);
  if (role === "transfer" && nonCallback.length > 0) return [nonCallback[0]];
  return nonCallback;
}

function callbackParamIndex(api) {
  return (api.parameters || []).findIndex(isCallbackParam);
}

function sourceEndpointAndKind(api) {
  const cbIndex = callbackParamIndex(api);
  if (cbIndex >= 0) {
    return {
      sourceKind: "callback_param",
      value: callbackArg(cbIndex, 0),
    };
  }
  if (api.kind === "property") {
    return {
      sourceKind: "field_read",
      value: ret([api.name]),
    };
  }
  return {
    sourceKind: "call_return",
    value: endpointForResult(api),
  };
}

function sinkEndpoints(api, family) {
  if (api.kind === "property") {
    return [receiver([api.name])];
  }
  const indexes = selectedPayloadArgIndexes(api, family, "sink");
  if (indexes.length > 0) return indexes.map(index => arg(index));
  if (api.kind === "method") return [receiver()];
  return [];
}

function transferPairs(api, family) {
  const fromIndexes = selectedPayloadArgIndexes(api, family, "transfer");
  const out = [];
  const cbIndex = callbackParamIndex(api);
  const callbackTarget = cbIndex >= 0 ? callbackArg(cbIndex, 0) : undefined;
  if (fromIndexes.length === 0) {
    if (returnsVoid(api) && callbackTarget && api.kind === "method") {
      out.push({ from: receiver(), to: callbackTarget });
      return out;
    }
    if (!returnsVoid(api)) out.push({ from: receiver(), to: endpointForResult(api) });
    return out;
  }
  if (!returnsVoid(api)) {
    for (const index of fromIndexes) out.push({ from: arg(index), to: endpointForResult(api) });
    return out;
  }
  if (callbackTarget) {
    for (const index of fromIndexes) out.push({ from: arg(index), to: callbackTarget });
    return out;
  }
  if (api.kind === "method") {
    for (const index of fromIndexes) out.push({ from: arg(index), to: receiver() });
  }
  return out;
}

function sanitizerPairs(api) {
  const idx = selectedPayloadArgIndexes(api, "", "sanitizer")[0];
  const from = idx === undefined ? receiver() : arg(idx);
  const cbIndex = callbackParamIndex(api);
  const to = returnsVoid(api) && cbIndex >= 0
    ? callbackArg(cbIndex, 0)
    : endpointForResult(api);
  return [{ from, to }];
}

function surfaceForApi(api, role, id) {
  const modulePath = api.file || "official.sdk";
  const ownerName = (api.context || []).join(".") || api.name || "OfficialApi";
  if (api.kind === "constructor") {
    return {
      surfaceId: `surface.${role}.${id}`,
      kind: "construct",
      modulePath,
      className: ownerName,
      argCount: (api.parameters || []).length,
      parameterTypes: (api.parameters || []).map(p => p.type || ""),
      signatureId: api.id,
      confidence: "certain",
      provenance: { source: "sdk", location: { file: api.file, line: api.line } },
    };
  }
  if (api.kind === "property") {
    return {
      surfaceId: `surface.${role}.${id}`,
      kind: "access",
      modulePath,
      ownerName,
      propertyName: api.name,
      accessKind: role === "source" || role === "load" ? "read" : "write",
      receiverKind: "instance",
      confidence: "certain",
      provenance: { source: "sdk", location: { file: api.file, line: api.line } },
    };
  }
  const isFunction = api.kind === "function" || ownerName === api.name;
  return {
    surfaceId: `surface.${role}.${id}`,
    kind: "invoke",
    modulePath,
    ownerName: isFunction ? undefined : ownerName,
    functionName: isFunction ? api.name : undefined,
    methodName: isFunction ? undefined : api.name,
    invokeKind: isFunction ? "free-function" : "instance",
    argCount: (api.parameters || []).length,
    parameterTypes: (api.parameters || []).map(p => p.type || ""),
    signatureId: api.id,
    confidence: "certain",
    provenance: { source: "sdk", location: { file: api.file, line: api.line } },
  };
}

function runtimeInvokeKind(kind) {
  return kind === "instance" || kind === "static" ? kind : "any";
}

function selectorForSurface(surface) {
  if (!surface || typeof surface !== "object") return undefined;
  if (surface.kind === "construct") {
    return {
      kind: "method-name-equals",
      value: surface.className,
      invokeKind: "any",
      argCount: surface.argCount,
      typeHint: surface.className,
      calleeScope: {
        className: { mode: "equals", value: surface.className },
      },
    };
  }
  if (surface.kind === "access") {
    return {
      kind: "declaring-class-equals",
      value: surface.ownerName,
      invokeKind: "any",
      typeHint: surface.ownerName,
      calleeScope: {
        className: { mode: "equals", value: surface.ownerName },
        methodName: { mode: "equals", value: surface.propertyName },
      },
    };
  }
  if (surface.kind !== "invoke") return undefined;
  if (surface.methodName) {
    return {
      kind: "method-name-equals",
      value: surface.methodName,
      invokeKind: runtimeInvokeKind(surface.invokeKind),
      argCount: surface.argCount,
      typeHint: surface.ownerName,
      calleeScope: surface.ownerName
        ? { className: { mode: "equals", value: surface.ownerName } }
        : undefined,
    };
  }
  if (surface.functionName) {
    return {
      kind: "method-name-equals",
      value: surface.functionName,
      invokeKind: runtimeInvokeKind(surface.invokeKind),
      argCount: surface.argCount,
      typeHint: surface.functionName,
    };
  }
  return undefined;
}

function hasArtifact(row, category) {
  const artifacts = (row.implementationArtifact || [])
    .filter(item => {
      const text = String(item);
      return !text.includes("official_declarations.rules.json")
        && !text.includes("official_declaration_semantic_slots.ts")
        && !text.includes("official_declarations.catalog.json");
    });
  if (category === "source") return artifacts.some(item => String(item).includes("/sources/") || String(item).includes("FrameworkApiSource") || String(item).includes("FrameworkCallbackSource"));
  if (category === "sink") return artifacts.some(item => String(item).includes("/sinks/") || String(item).includes("FrameworkSink"));
  if (category === "transfer") return artifacts.some(item => String(item).includes("/transfers/"));
  if (category === "sanitizer") return artifacts.some(item => String(item).includes("/sanitizers/") || String(item).includes("FrameworkSanitizer"));
  if (category === "module") return artifacts.some(item => String(item).includes("src/models/kernel/modules"));
  if (category === "arkmain") return artifacts.some(item => String(item).includes("src/models/kernel/arkmain"));
  return false;
}

function categoriesForRole(role) {
  if (role === "source") return ["source"];
  if (role === "sink") return ["sink"];
  if (role === "transfer") return ["transfer"];
  if (role === "sanitizer") return ["sanitizer"];
  if (role === "arkmain-entry") return ["arkmain"];
  if (role === "load" || role === "store" || role === "kill" || role === "handoff" || role === "handle") return ["module"];
  return [];
}

function roleNeedsGeneration(row, role, category) {
  if (row.manualReviewStatus !== "confirmed") return false;
  return !hasArtifact(row, category);
}

function addSurface(asset, surface) {
  if (!asset._surfaces.has(surface.surfaceId)) {
    asset._surfaces.set(surface.surfaceId, surface);
    asset.surfaces.push(surface);
  }
}

function newRuleAsset(role) {
  return {
    id: `asset.rule.kernel.${role}s.official_declarations`,
    plane: "rule",
    status: "official",
    surfaces: [],
    bindings: [],
    effectTemplates: [],
    provenance: {
      source: "builtin",
      evidenceLocations: [
        { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
        { file: "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json" },
      ],
    },
    _surfaces: new Map(),
  };
}

function addRuleBinding(asset, api, row, role, value, options = {}) {
  const id = `${cleanFamily(row.family)}.${role}.${hash(row.signatureKey + JSON.stringify(value) + (options.ordinal || ""))}`;
  const surface = surfaceForApi(api, role, id);
  addSurface(asset, surface);
  const templateId = `template.${role}.${id}`;
  const bindingId = `binding.${role}.${id}`;
  const template =
    role === "source" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.source",
      value,
      sourceKind: options.sourceKind || "call_return",
    } :
    role === "sink" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.sink",
      value,
      sinkKind: row.family,
    } :
    role === "transfer" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.transfer",
      from: value.from,
      to: value.to,
      transferKind: row.family,
    } : {
      id: templateId,
      confidence: "certain",
      kind: "rule.sanitizer",
      value: value.to,
      sanitizerKind: row.family,
      strength: "strong",
    };
  asset.effectTemplates.push(template);
  asset.bindings.push({
    bindingId,
    surfaceId: surface.surfaceId,
    assetId: asset.id,
    plane: "rule",
    role,
    selector: selectorForSurface(surface),
    endpoint: role === "transfer" || role === "sanitizer" ? value.to : value,
    effectTemplateRefs: [templateId],
    semanticsFamily: row.family,
    metadata: {
      enabled: true,
      description: `Official SDK declaration ${row.signatureKey} as ${role}.`,
      tags: ["harmony", "official-declaration"],
    },
    completeness: "complete",
    confidence: "certain",
  });
}

function handleFor(row, api) {
  const keyArgIndex = selectedPayloadArgIndexes(api, row.family, "handle")
    .find(index => /key|id|uri|url|path|name|table|type/i.test(String((api.parameters || [])[index]?.name || "")));
  const key = [
    { kind: "const", value: row.capabilityFamily || row.family },
    { kind: "const", value: row.namespaceOrClass || (api.context || []).join(".") || "OfficialApi" },
  ];
  if (keyArgIndex !== undefined) {
    key.push({ kind: "fromEndpoint", endpoint: arg(keyArgIndex) });
  } else {
    key.push({ kind: "const", value: "default" });
  }
  return {
    cellKind: row.stateCellKind || "keyed-semantic-slot",
    family: row.capabilityFamily || row.family,
    key,
    precision: keyArgIndex !== undefined ? "infer" : "partial",
  };
}

function moduleEffectsForApi(api, row) {
  if (api.kind === "property") return [];
  const out = [];
  const handle = handleFor(row, api);
  const loadTarget = endpointForResult(api);
  const valueIndexes = selectedPayloadArgIndexes(api, row.family, "store");
  const firstValue = valueIndexes[0] !== undefined ? arg(valueIndexes[0]) : arg(0);
  const roles = new Set(row.roles || []);
  const baseId = `${cleanFamily(row.family)}.module.${hash(row.signatureKey)}`;
  if (roles.has("store") || (roles.has("handoff") && valueIndexes.length > 0)) {
    out.push({ id: `template.${baseId}.put`, kind: "handoff.put", handle, value: firstValue, updateStrength: "infer", confidence: "certain" });
  }
  if (roles.has("load") || roles.has("handle") || (roles.has("handoff") && !roles.has("store"))) {
    out.push({ id: `template.${baseId}.get`, kind: "handoff.get", handle, target: loadTarget, confidence: "certain" });
  }
  if (roles.has("kill")) {
    out.push({ id: `template.${baseId}.kill`, kind: "handoff.kill", handle, updateStrength: "strong", confidence: "certain" });
  }
  return out;
}

function newModuleAssetGroup(row) {
  const family = cleanFamily(row.family);
  return {
    id: `asset.module.kernel.official_declarations.${family}`,
    plane: "module",
    status: "official",
    surfaces: [],
    bindings: [],
    effectTemplates: [],
    provenance: {
      source: "builtin",
      evidenceLocations: [
        { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
        { file: "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json" },
      ],
    },
    _surfaceIds: new Set(),
    _bindingIds: new Set(),
    _templateIds: new Set(),
    _evidenceLocations: new Set(),
  };
}

function addModuleDeclarationAsset(moduleAssetGroups, api, row, effects) {
  const family = cleanFamily(row.family);
  let asset = moduleAssetGroups.get(family);
  if (!asset) {
    asset = newModuleAssetGroup(row);
    moduleAssetGroups.set(family, asset);
  }
  const id = `${family}.module.${hash(row.signatureKey)}`;
  const surface = surfaceForApi(api, "handoff", id);
  if (!asset._surfaceIds.has(surface.surfaceId)) {
    asset._surfaceIds.add(surface.surfaceId);
    asset.surfaces.push(surface);
  }
  const bindingId = `binding.${id}`;
  if (!asset._bindingIds.has(bindingId)) {
    asset._bindingIds.add(bindingId);
    asset.bindings.push({
      bindingId,
      surfaceId: surface.surfaceId,
      assetId: asset.id,
      plane: "module",
      role: "handoff",
      endpoint: effects[0].kind === "handoff.get" ? effects[0].target : effects[0].value,
      effectTemplateRefs: effects.map(effect => effect.id),
      semanticsFamily: row.family,
      metadata: { description: `Official SDK declaration ${row.signatureKey} as module handoff.` },
      completeness: "complete",
      confidence: "certain",
    });
  }
  for (const effect of effects) {
    if (asset._templateIds.has(effect.id)) continue;
    asset._templateIds.add(effect.id);
    asset.effectTemplates.push(effect);
  }
  const evidenceKey = `${row.sdkFile || ""}:${row.line || ""}`;
  if (row.sdkFile && !asset._evidenceLocations.has(evidenceKey)) {
    asset._evidenceLocations.add(evidenceKey);
    asset.provenance.evidenceLocations.push({ file: row.sdkFile, line: row.line });
  }
}

function finalizeModuleAssetGroups(moduleAssetGroups) {
  return [...moduleAssetGroups.values()]
    .map(asset => {
      delete asset._surfaceIds;
      delete asset._bindingIds;
      delete asset._templateIds;
      delete asset._evidenceLocations;
      asset.surfaces.sort((a, b) => a.surfaceId.localeCompare(b.surfaceId));
      asset.bindings.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
      asset.effectTemplates.sort((a, b) => a.id.localeCompare(b.id));
      asset.provenance.evidenceLocations.sort((a, b) =>
        String(a.file || "").localeCompare(String(b.file || ""))
        || Number(a.line || 0) - Number(b.line || 0),
      );
      return asset;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function safeJsonChunks(json, chunkSize) {
  const chunks = [];
  let index = 0;
  while (index < json.length) {
    let end = Math.min(index + chunkSize, json.length);
    while (end < json.length && /[A-Za-z0-9_]/.test(json[end - 1])) {
      end++;
    }
    chunks.push(json.slice(index, end));
    index = end;
  }
  return chunks;
}

function generatedModuleTs(moduleAssets) {
  const json = JSON.stringify(moduleAssets);
  const chunkSize = 12000;
  const chunks = safeJsonChunks(json, chunkSize);
  const coverageTokens = [];
  const seenCoverageTokens = new Set();
  for (const asset of moduleAssets) {
    for (const surface of asset.surfaces || []) {
      const values = [
        surface.ownerName,
        surface.className,
        surface.methodName,
        surface.functionName,
        surface.propertyName,
      ].filter(Boolean);
      for (const value of values) {
        const text = String(value);
        if (!seenCoverageTokens.has(text)) {
          seenCoverageTokens.add(text);
          coverageTokens.push(text);
        }
      }
    }
  }
  return [
    "import type { AssetDocumentBase } from \"../../../../core/assets/schema\";",
    "",
    "export const officialDeclarationCoverageIndex: string[] = [",
    ...coverageTokens.sort((a, b) => a.localeCompare(b)).map(token => `  ${JSON.stringify(token)},`),
    "];",
    "",
    "const raw = [",
    ...chunks.map(chunk => `  ${JSON.stringify(chunk)},`),
    "].join(\"\");",
    "",
    "const modules = JSON.parse(raw) as AssetDocumentBase[];",
    "",
    "export default modules;",
    "",
  ].join("\n");
}

function main() {
  const inventory = readJson(INVENTORY);
  const ledgerDoc = readJson(LEDGER);
  const apiByKey = new Map((inventory.apis || []).map(api => [apiKey(api), api]));
  const rows = ledgerDoc.rows || [];
  const ruleAssets = {
    source: newRuleAsset("source"),
    sink: newRuleAsset("sink"),
    transfer: newRuleAsset("transfer"),
    sanitizer: newRuleAsset("sanitizer"),
  };
  const moduleAssetGroups = new Map();
  const arkmainMethods = [];
const stats = {
    source: 0,
    sink: 0,
    transfer: 0,
    sanitizer: 0,
    module: 0,
    arkmain: 0,
    skippedNoApi: 0,
    propertyModuleRoleCoveredByRule: 0,
    skippedUnsupportedModuleSurface: 0,
  };

  for (const row of rows) {
    if (row.manualReviewStatus !== "confirmed") continue;
    const api = apiByKey.get(row.signatureKey);
    if (!api) {
      stats.skippedNoApi++;
      continue;
    }
    const generatedStatefulCategories = new Set();
    for (const role of row.roles || []) {
      for (const category of categoriesForRole(role)) {
        if (category === "module" || category === "arkmain") {
          if (generatedStatefulCategories.has(category)) continue;
          generatedStatefulCategories.add(category);
        }
        if (!roleNeedsGeneration(row, role, category)) continue;
        if (category === "source") {
          const source = sourceEndpointAndKind(api);
          addRuleBinding(ruleAssets.source, api, row, "source", source.value, { sourceKind: source.sourceKind });
          stats.source++;
          continue;
        }
        if (category === "sink") {
          const endpoints = sinkEndpoints(api, row.family);
          for (const [ordinal, endpoint] of endpoints.entries()) {
            addRuleBinding(ruleAssets.sink, api, row, "sink", endpoint, { ordinal });
            stats.sink++;
          }
          continue;
        }
        if (category === "transfer") {
          for (const [ordinal, pair] of transferPairs(api, row.family).entries()) {
            addRuleBinding(ruleAssets.transfer, api, row, "transfer", pair, { ordinal });
            stats.transfer++;
          }
          continue;
        }
        if (category === "sanitizer") {
          for (const [ordinal, pair] of sanitizerPairs(api).entries()) {
            addRuleBinding(ruleAssets.sanitizer, api, row, "sanitizer", pair, { ordinal });
            stats.sanitizer++;
          }
          continue;
        }
        if (category === "module") {
          const effects = moduleEffectsForApi(api, row);
          if (effects.length === 0) {
            if (api.kind === "property") {
              stats.propertyModuleRoleCoveredByRule++;
              continue;
            }
            stats.skippedUnsupportedModuleSurface++;
            continue;
          }
          addModuleDeclarationAsset(moduleAssetGroups, api, row, effects);
          stats.module++;
          continue;
        }
        if (category === "arkmain") {
          arkmainMethods.push({
            owner: row.namespaceOrClass,
            method: row.member,
            kind: row.kind,
            argCount: row.argCount,
            signatureKey: row.signatureKey,
          });
          stats.arkmain++;
        }
      }
    }
  }

  for (const [role, asset] of Object.entries(ruleAssets)) {
    delete asset._surfaces;
    const file =
      role === "source" ? "src/models/kernel/rules/sources/official_declarations.rules.json" :
      role === "sink" ? "src/models/kernel/rules/sinks/official_declarations.rules.json" :
      role === "transfer" ? "src/models/kernel/rules/transfers/official_declarations.rules.json" :
      "src/models/kernel/rules/sanitizers/official_declarations.rules.json";
    writeJson(file, asset);
  }

  writeText(
    "src/models/kernel/modules/harmony/official_declaration_semantic_slots.ts",
    generatedModuleTs(finalizeModuleAssetGroups(moduleAssetGroups)),
  );

  const arkmainOutputFile = "src/models/kernel/arkmain/harmony/official_declarations.catalog.json";
  if (arkmainMethods.length > 0) {
    writeJson(arkmainOutputFile, {
      id: "asset.module.kernel.arkmain.official_declarations",
      plane: "module",
      status: "official",
      surfaces: [{
        surfaceId: "surface.arkmain.official_declarations.entry",
        kind: "entry",
        ownerKind: "ability",
        ownerName: "official-declarations",
        methodName: "official-declarations",
        phase: "lifecycle",
        entryKind: "official-declarations",
        confidence: "certain",
        provenance: { source: "sdk" },
      }],
      bindings: [{
        bindingId: "binding.arkmain.official_declarations.entry",
        surfaceId: "surface.arkmain.official_declarations.entry",
        assetId: "asset.module.kernel.arkmain.official_declarations",
        plane: "module",
        role: "entry",
        endpoint: { base: { kind: "return" } },
        effectTemplateRefs: ["template.arkmain.official_declarations.capability"],
        completeness: "complete",
        confidence: "certain",
      }],
      effectTemplates: [{
        id: "template.arkmain.official_declarations.capability",
        kind: "core.capability",
        capability: "arkmain.official-entry-declarations",
        payload: {
          lifecycleMethods: arkmainMethods,
        },
        confidence: "certain",
      }],
      provenance: {
        source: "builtin",
        evidenceLocations: [
          { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
        ],
      },
    });
  } else {
    removeIfExists(arkmainOutputFile);
  }

  writeJson("internal_docs/security_asset_iteration/official_api_semantic_asset_generation_summary.json", {
    generatedAt: new Date().toISOString(),
    stats,
    moduleAssetGroups: moduleAssetGroups.size,
    outputFiles: [
      "src/models/kernel/rules/sources/official_declarations.rules.json",
      "src/models/kernel/rules/sinks/official_declarations.rules.json",
      "src/models/kernel/rules/transfers/official_declarations.rules.json",
      "src/models/kernel/rules/sanitizers/official_declarations.rules.json",
      "src/models/kernel/modules/harmony/official_declaration_semantic_slots.ts",
      ...(arkmainMethods.length > 0 ? ["src/models/kernel/arkmain/harmony/official_declarations.catalog.json"] : []),
    ],
  });

  console.log(`generated official api semantic assets ${JSON.stringify(stats)}`);
}

main();
