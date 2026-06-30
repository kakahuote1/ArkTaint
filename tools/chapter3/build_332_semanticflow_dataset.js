const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const datasetRoot = path.join(
  repoRoot,
  "internal_docs/reports/chapter3_experiment_artifacts/final/datasets/semanticflow_332",
);

const {
  discoverApiSurfaceModelingCandidates,
  discoverApiCallbackModelingCandidates,
} = require(path.join(repoRoot, "out/core/semanticflow/ApiModelingCandidateScanner"));
const {
  buildSemanticFlowApiModelingCandidateItem,
  buildSemanticFlowArkMainCandidateItem,
} = require(path.join(repoRoot, "out/core/semanticflow/SemanticFlowAdapters"));
const { buildSemanticFlowPrompt } = require(path.join(repoRoot, "out/core/semanticflow/SemanticFlowPrompt"));
const { Scene } = require(path.join(repoRoot, "arkanalyzer/out/src/Scene"));
const { SceneConfig } = require(path.join(repoRoot, "arkanalyzer/out/src/Config"));
const {
  buildArkMainEntryCandidates,
} = require(path.join(repoRoot, "out/core/entry/arkmain/llm/ArkMainEntryCandidateBuilder"));

const RECOMMENDED_PROFILE = "deepseek-v4-pro";
const SOURCE_DIRS = ["entry/src/main/ets"];
const REQUIRED_LLM_READY = 200;
const REQUIRED_NEGATIVE_RATIO = 0.25;
const GENERATED_AT = new Date().toISOString();

const OLD_IDENTITY_FIELDS = [
  "schemaVersion",
  "modelVersion",
  "assetVersion",
  "runtimeShape",
  "modulePath",
  "ownerName",
  "functionName",
  "methodName as surface identity",
  "invokeKind",
  "argCount",
  "parameterTypes",
  "returnType",
  "signatureId",
  "callee_signature",
  "sourceFile",
  "fallback",
  "version",
  "selector",
];

function main() {
  resetDatasetRoot();
  const scenarios = buildScenarioSpecs();
  const records = [];
  const gaps = [];
  const llmRequests = [];
  const counters = new Map();

  for (const scenario of scenarios) {
    writeScenarioProject(scenario);
    const projectDir = path.join(datasetRoot, "scenarios", scenario.scenarioId, "project");
    const apiCandidates = discoverApiSurfaceModelingCandidates(projectDir, SOURCE_DIRS, { maxCandidates: 500 });
    const callbackCandidates = discoverApiCallbackModelingCandidates(projectDir, SOURCE_DIRS, { maxCandidates: 500 });
    const allCandidates = [...apiCandidates, ...callbackCandidates];
    const exactCandidates = allCandidates.filter(candidate => typeof candidate.canonicalApiId === "string" && candidate.canonicalApiId.trim());

    for (const spec of scenario.samples) {
      const sampleId = nextSampleId(counters, samplePrefix(spec));
      const selected = selectCandidate(exactCandidates, spec);
      if (!selected) {
        const record = writeNotReadyRecord({
          sampleId,
          scenario,
          spec,
          reason: "engine-not-selected-or-no-exact-canonical-api-id",
          candidates: allCandidates,
        });
        records.push(record);
        gaps.push({
          sampleId,
          scenarioId: scenario.scenarioId,
          method: spec.method,
          reason: "expected API candidate was not selected with exact canonicalApiId",
          candidateCount: allCandidates.length,
          exactCandidateCount: exactCandidates.length,
        });
        continue;
      }
      const item = buildSemanticFlowApiModelingCandidateItem(selected, {
        maxContextSlices: 3,
        companionCandidates: exactCandidates,
      });
      const record = writeReadyRecord({
        sampleId,
        scenario,
        spec,
        item,
        candidate: selected,
        sourceKind: "api",
      });
      records.push(record);
      llmRequests.push(record.llmRequest);
    }

    for (const negative of scenario.engineNotSelected) {
      const sampleId = nextSampleId(counters, "SF332-NEG-ENGINE");
      const selected = selectCandidate(exactCandidates, negative);
      const record = writeNotReadyRecord({
        sampleId,
        scenario,
        spec: negative,
        reason: selected ? "unexpected-engine-selected" : "engine-not-selected",
        candidates: allCandidates,
      });
      records.push(record);
      if (selected) {
        gaps.push({
          sampleId,
          scenarioId: scenario.scenarioId,
          method: negative.method,
          reason: "ordinary helper was unexpectedly selected by scanner",
          canonicalApiId: selected.canonicalApiId,
        });
      }
    }

    const arkMainOutcome = buildArkMainSamples(scenario, projectDir, counters);
    records.push(...arkMainOutcome.records);
    llmRequests.push(...arkMainOutcome.llmRequests);
    gaps.push(...arkMainOutcome.gaps);
  }

  writeManifests(records, llmRequests, gaps);
  const validation = validateDataset(records, llmRequests);
  writeSummary(records, gaps, validation, scenarios.length);
  writeReusablePromptTemplate();
  writeBuildLog(records, gaps, validation, scenarios.length);

  if (!validation.ok) {
    throw new Error(`semanticflow 3.3.2 dataset validation failed: ${validation.errors.join("; ")}`);
  }
  console.log(JSON.stringify({
    datasetRoot,
    scenarios: scenarios.length,
    samples: records.length,
    llmReady: records.filter(record => record.llmReady).length,
    negatives: records.filter(record => record.isNegative).length,
    gaps: gaps.length,
  }, null, 2));
}

function resetDatasetRoot() {
  fs.rmSync(datasetRoot, { recursive: true, force: true });
  for (const dir of ["scenarios", "slices", "prompts", "oracle"]) {
    fs.mkdirSync(path.join(datasetRoot, dir), { recursive: true });
  }
}

function buildScenarioSpecs() {
  const scenarios = [];
  const familyOrder = [
    "source", "source", "source", "source",
    "sink", "sink", "sink", "sink", "sink",
    "transfer", "transfer", "transfer", "transfer",
    "sanitizer", "sanitizer", "sanitizer",
    "event", "event", "event", "event",
    "storage", "storage", "storage", "storage", "storage",
    "router", "router", "router",
    "worker", "worker",
    "complex", "complex",
  ];
  familyOrder.forEach((family, index) => {
    scenarios.push(makeScenario(index + 1, family));
  });
  return scenarios;
}

function makeScenario(index, family) {
  const tag = String(index).padStart(2, "0");
  const className = `${capitalize(family)}Scenario${tag}Kit`;
  const pageName = `${capitalize(family)}Scenario${tag}Page`;
  const dir = scenarioDirectory(family);
  const fileRel = `entry/src/main/ets/${dir}/${className}.ets`;
  const scenarioId = `${family}_${scenarioSlug(family, index)}_${tag}`;
  const samples = scenarioSamples(family, tag, fileRel, className);
  return {
    scenarioId,
    family,
    scenarioFamily: scenarioFamilyLabel(family),
    complexityLevel: scenarioComplexity(family, index),
    includeAbility: index <= 4,
    className,
    abilityName: `${capitalize(family)}Scenario${tag}Ability`,
    pageName,
    dir,
    fileRel,
    description: scenarioDescription(family),
    samples,
    engineNotSelected: [
      {
        method: `formatPlainLabel${tag}`,
        sourceFile: "entry/src/main/ets/common/PlainHelper.ets",
        expectedDecision: "reject",
        expectedPlane: null,
        expectedSemanticRole: "none",
        expectedEffectKinds: [],
        expectedEndpointSemantics: "Plain label formatting is ordinary UI/business logic and should not become a semantic asset.",
        negativeReason: "ordinary_business_helper_without_security_semantics",
        complexityLevel: "simple",
        scenarioFamily: "negative/ordinary-helper",
        llmExpected: false,
      },
    ],
  };
}

function scenarioDirectory(family) {
  return {
    source: "services",
    sink: "network",
    transfer: "services",
    sanitizer: "services",
    event: "common/events",
    storage: "cache",
    router: "navigation",
    worker: "worker",
    complex: "sdk",
  }[family] || "services";
}

function scenarioSlug(family, index) {
  const slugs = {
    source: ["device_token", "profile_promise", "callback_payload", "field_negative"],
    sink: ["logging", "network", "file", "rdb", "router"],
    transfer: ["arg_return", "field_return", "promise", "callback"],
    sanitizer: ["strong", "redaction", "weak"],
    event: ["eventhub", "channel", "no_payload", "mismatch"],
    storage: ["preferences", "appstorage", "localstorage", "map", "object_field"],
    router: ["navigation", "promise_task", "callback_register"],
    worker: ["taskpool", "worker_result"],
    complex: ["vendor_sdk", "import_shapes"],
  };
  const list = slugs[family] || ["case"];
  return list[(index - 1) % list.length];
}

function scenarioFamilyLabel(family) {
  return {
    source: "A.rule/source",
    sink: "B.rule/sink",
    transfer: "C.rule/transfer",
    sanitizer: "D.rule/sanitizer",
    event: "E.module/event",
    storage: "F.module/storage-state",
    router: "G.module/router-promise-callback",
    worker: "G.module/worker-taskpool",
    complex: "I.complex-real-project-like-wrappers",
  }[family] || family;
}

function scenarioComplexity(family, index) {
  if (family === "complex") return "complex";
  if (family === "storage" || family === "event" || family === "router" || family === "worker") return index % 2 === 0 ? "complex" : "medium";
  return index % 3 === 0 ? "medium" : "simple";
}

function scenarioDescription(family) {
  return {
    source: "External data wrappers returning device IDs, tokens, profiles, promises, and callback payloads.",
    sink: "Outbound boundaries for logs, network payloads, files, databases, and router parameters.",
    transfer: "Visible value-preserving wrappers across returns, object fields, promises, and callback arguments.",
    sanitizer: "Strong sanitizers, weak transformations, and sanitizer-looking negative helpers.",
    event: "Project event bus wrappers with on/emit/off channels, payload and no-payload dispatch, and mismatch negatives.",
    storage: "Persistent storage, reactive state, map entries, and object-field receiver carriers.",
    router: "Navigation parameter handoff, promise result handoff, and callback registration evidence.",
    worker: "Taskpool and worker-style async result handoff wrappers.",
    complex: "Real-project-like vendor SDK wrappers with imports, overload-like names, rest/spread, and object shapes.",
  }[family] || "SemanticFlow synthetic ArkTS scenario.";
}

function scenarioSamples(family, tag, fileRel, className) {
  const common = { sourceFile: fileRel, className };
  const builders = {
    source: () => [
      apiSample(common, {
        method: `getDeviceId${tag}`,
        returnType: "string",
        body: ["const deviceId = NativeDevice.readDeviceId();", "return deviceId;"],
        role: "source",
        effectKinds: ["rule.source"],
        endpoint: ret(),
        endpointText: "NativeDevice.readDeviceId introduces an external device identifier at the return value.",
        family: "A.rule/source.return-device-id",
      }),
      apiSample(common, {
        method: `fetchAccessToken${tag}`,
        returnType: "Promise<string>",
        body: ["const token = AuthBridge.requestAccessToken();", "return Promise.resolve(token);"],
        role: "source",
        effectKinds: ["rule.source"],
        endpoint: promiseResult(),
        endpointText: "The fulfilled Promise value carries an external access token.",
        family: "A.rule/source.promise-token",
        semanticFocus: "returned_value_surface",
      }),
      apiSample(common, {
        method: `readUserProfile${tag}`,
        returnType: "Record<string, string>",
        body: ["const profile = AccountBridge.readUserProfile();", "return profile;"],
        role: "source",
        effectKinds: ["rule.source"],
        endpoint: ret(),
        endpointText: "The returned profile object comes from an external account bridge.",
        family: "A.rule/source.profile-object",
        semanticFocus: "returned_value_surface",
      }),
      apiSample(common, {
        method: `listenProfileMessage${tag}`,
        params: [{ name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: [
          "NativeChat.listen((payload: string) => {",
          "  callback(payload);",
          "});",
        ],
        role: "source",
        effectKinds: ["rule.source"],
        endpoint: callbackArg(0, 0),
        endpointText: "The callback parameter receives external chat payload data.",
        family: "A.rule/source.callback-parameter",
      }),
      negativeSample(common, {
        method: `readCachedField${tag}`,
        returnType: "string",
        body: ["const cached = this.cachedValue;", "return cached;"],
        endpointText: "A receiver field read is not an external source by itself.",
        negativeReason: "field_read_without_external_source",
        family: "A.rule/source.negative-field-read",
      }),
      needMoreSample(common, {
        method: `readUnknownProvider${tag}`,
        returnType: "string",
        body: ["const value = provider.get();", "return value;"],
        endpointText: "The provider origin is not evidenced enough to classify the return as source.",
        negativeReason: "unresolved_external_provider_evidence",
        family: "A.rule/source.need-more-provider",
      }),
    ],
    sink: () => [
      apiSample(common, {
        method: `logSecret${tag}`,
        params: [{ name: "secret", type: "string" }],
        returnType: "void",
        body: ["console.info(secret);"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The secret argument is disclosed to a logging boundary.",
        family: "B.rule/sink.logging",
      }),
      apiSample(common, {
        method: `sendRequestBody${tag}`,
        params: [{ name: "body", type: "string" }],
        returnType: "void",
        body: ["HttpClient.post('/login', body);"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The body argument is sent as network request payload.",
        family: "B.rule/sink.network-body",
      }),
      apiSample(common, {
        method: `sendAuthHeader${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "void",
        body: ["HttpClient.request({ headers: { Authorization: token } });"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The token argument is placed in an outgoing Authorization header.",
        family: "B.rule/sink.network-header",
      }),
      apiSample(common, {
        method: `writeProfileFile${tag}`,
        params: [{ name: "filePath", type: "string" }, { name: "content", type: "string" }],
        returnType: "void",
        body: ["FileClient.write(filePath, content);"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(1),
        endpointText: "The content argument is written to a file boundary; filePath is destination metadata.",
        family: "B.rule/sink.file-write",
      }),
      apiSample(common, {
        method: `insertUserRecord${tag}`,
        params: [{ name: "record", type: "string" }],
        returnType: "void",
        body: ["RdbClient.insert('user', record);"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The record argument is inserted into a database table.",
        family: "B.rule/sink.rdb-insert",
      }),
      apiSample(common, {
        method: `openDetailWithSecret${tag}`,
        params: [{ name: "secret", type: "string" }],
        returnType: "void",
        body: ["Router.pushUrl({ url: 'pages/Detail', params: { secret: secret } });"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The secret argument is placed into router navigation parameters.",
        family: "B.rule/sink.router-navigation-param",
      }),
      negativeSample(common, {
        method: `configureRequestMeta${tag}`,
        params: [{ name: "url", type: "string" }, { name: "method", type: "string" }],
        returnType: "void",
        body: ["HttpClient.request({ url: url, method: method, body: 'fixed' });"],
        endpointText: "URL and HTTP method are control/destination metadata, not payload disclosure in this slice.",
        negativeReason: "control_metadata_not_payload_sink",
        family: "B.rule/sink.negative-control-metadata",
      }),
    ],
    transfer: () => [
      apiSample(common, {
        method: `copyToken${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "string",
        body: ["const copied = token.trim();", "return copied;"],
        role: "transfer",
        effectKinds: ["rule.transfer"],
        endpoint: ret(),
        expectedBindings: [{ role: "transfer", endpoint: ret(), effectKind: "rule.transfer", from: arg(0), to: ret() }],
        endpointText: "The argument value is preserved into the returned string.",
        family: "C.rule/transfer.arg0-return",
      }),
      apiSample(common, {
        method: `copySecretField${tag}`,
        params: [{ name: "payload", type: "Record<string, string>" }],
        returnType: "Record<string, string>",
        body: ["const result = { secret: payload.secret, id: payload.id };", "return result;"],
        role: "transfer",
        effectKinds: ["rule.transfer"],
        endpoint: retPath(["secret"]),
        expectedBindings: [{ role: "transfer", endpoint: retPath(["secret"]), effectKind: "rule.transfer", from: argPath(0, ["secret"]), to: retPath(["secret"]) }],
        endpointText: "payload.secret is copied to result.secret.",
        family: "C.rule/transfer.arg-field-return-field",
      }),
      apiSample(common, {
        method: `resolveAsyncValue${tag}`,
        params: [{ name: "value", type: "string" }],
        returnType: "Promise<string>",
        body: ["return Promise.resolve(value);"],
        role: "transfer",
        effectKinds: ["rule.transfer"],
        endpoint: promiseResult(),
        expectedBindings: [{ role: "transfer", endpoint: promiseResult(), effectKind: "rule.transfer", from: arg(0), to: promiseResult() }],
        endpointText: "The argument value is transferred to the fulfilled Promise result.",
        family: "C.rule/transfer.arg-promise-result",
      }),
      apiSample(common, {
        method: `forwardToCallback${tag}`,
        params: [{ name: "value", type: "string" }, { name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["callback(value);"],
        role: "transfer",
        effectKinds: ["rule.transfer"],
        endpoint: callbackArg(1, 0),
        expectedBindings: [{ role: "transfer", endpoint: callbackArg(1, 0), effectKind: "rule.transfer", from: arg(0), to: callbackArg(1, 0) }],
        endpointText: "The first argument is forwarded into callback argument 0.",
        family: "C.rule/transfer.arg-callbackarg",
      }),
      negativeSample(common, {
        method: `returnConstant${tag}`,
        params: [{ name: "value", type: "string" }],
        returnType: "string",
        body: ["return 'constant';"],
        endpointText: "The input argument is discarded and the return is constant.",
        negativeReason: "conditional_or_constant_drop_no_transfer",
        family: "C.rule/transfer.negative-constant-return",
      }),
      negativeSample(common, {
        method: `formatButDropSecret${tag}`,
        params: [{ name: "secret", type: "string" }],
        returnType: "string",
        body: ["const length = secret.length;", "return 'len=' + length;"],
        endpointText: "The original secret value is not preserved, only its length is formatted.",
        negativeReason: "formatting_does_not_preserve_value_semantics",
        family: "C.rule/transfer.negative-lossy-format",
      }),
    ],
    sanitizer: () => [
      apiSample(common, {
        method: `hashPassword${tag}`,
        params: [{ name: "password", type: "string" }],
        returnType: "string",
        body: ["return Crypto.sha256(password);"],
        role: "sanitizer",
        effectKinds: ["rule.sanitizer"],
        endpoint: arg(0),
        endpointText: "A cryptographic one-way hash is a strong sanitizer for direct disclosure.",
        family: "D.rule/sanitizer.strong-hash",
      }),
      apiSample(common, {
        method: `redactToken${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "string",
        body: ["return token.replace(/[A-Za-z0-9]/g, '*');"],
        role: "sanitizer",
        effectKinds: ["rule.sanitizer"],
        endpoint: ret(),
        endpointText: "The returned token is explicitly redacted before disclosure.",
        family: "D.rule/sanitizer.redaction",
      }),
      apiSample(common, {
        method: `escapeHtmlContent${tag}`,
        params: [{ name: "content", type: "string" }],
        returnType: "string",
        body: ["return content.replace('<', '&lt;').replace('>', '&gt;');"],
        role: "sanitizer",
        effectKinds: ["rule.sanitizer"],
        endpoint: ret(),
        endpointText: "The returned string is HTML-escaped for an HTML/script injection context.",
        family: "D.rule/sanitizer.escape-html",
      }),
      needMoreSample(common, {
        method: `weakMaskToken${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "string",
        body: ["return token.substring(0, 3) + '***';"],
        endpointText: "Partial masking may leave sensitive data and needs more policy evidence before sanitizer modeling.",
        negativeReason: "weak_or_uncertain_sanitizer",
        family: "D.rule/sanitizer.need-more-weak-mask",
      }),
      negativeSample(common, {
        method: `stringifyPayload${tag}`,
        params: [{ name: "payload", type: "Record<string, string>" }],
        returnType: "string",
        body: ["return JSON.stringify(payload);"],
        endpointText: "JSON.stringify is serialization, not sanitization.",
        negativeReason: "stringify_not_sanitizer",
        family: "D.rule/sanitizer.negative-stringify",
      }),
      negativeSample(common, {
        method: `validateNameOnly${tag}`,
        params: [{ name: "value", type: "string" }],
        returnType: "string",
        body: ["if (value.length > 0) { return value; }", "return value;"],
        endpointText: "The validate-named helper returns the original value without cleaning evidence.",
        negativeReason: "validate_name_without_cleaning_evidence",
        family: "D.rule/sanitizer.negative-validate-name",
      }),
    ],
    event: () => [
      moduleSample(common, {
        method: `onEvent${tag}`,
        params: [{ name: "channel", type: "string" }, { name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["const list = this.listeners.get(channel) || [];", "list.push(callback);", "this.listeners.set(channel, list);"],
        role: "handoff",
        effectKinds: ["module.eventEmitter"],
        endpoint: callbackArg(1, 0),
        endpointText: "Registers a callback for a channel in the project event hub.",
        family: "E.module/event.on",
      }),
      moduleSample(common, {
        method: `emitEvent${tag}`,
        params: [{ name: "channel", type: "string" }, { name: "payload", type: "string" }],
        returnType: "void",
        body: ["const list = this.listeners.get(channel) || [];", "for (const callback of list) { callback(payload); }"],
        role: "handoff",
        effectKinds: ["module.eventEmitter", "handoff.put"],
        endpoint: arg(1),
        endpointText: "Publishes payload to callbacks registered on the same channel.",
        family: "E.module/event.emit",
      }),
      moduleSample(common, {
        method: `offEvent${tag}`,
        params: [{ name: "channel", type: "string" }],
        returnType: "void",
        body: ["this.listeners.delete(channel);"],
        role: "handoff",
        effectKinds: ["handoff.kill"],
        endpoint: arg(0),
        endpointText: "Removes the registered event channel slot.",
        family: "E.module/event.kill",
      }),
      moduleSample(common, {
        method: `emitTick${tag}`,
        params: [{ name: "channel", type: "string" }],
        returnType: "void",
        body: ["const list = this.listeners.get(channel) || [];", "for (const callback of list) { callback(''); }"],
        role: "handoff",
        effectKinds: ["module.eventEmitter"],
        endpoint: arg(0),
        endpointText: "Dispatches callbacks by channel without an input payload argument.",
        family: "E.module/event.emit-no-payload",
      }),
      needMoreSample(common, {
        method: `onOnlyWithoutEmit${tag}`,
        params: [{ name: "channel", type: "string" }, { name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["const list = this.listeners.get(channel) || [];", "list.push(callback);", "this.listeners.set(channel, list);"],
        endpointText: "Registration without matching emit evidence should request relation evidence.",
        negativeReason: "callback_registration_without_activation_evidence",
        family: "E.module/event.need-more-on-only",
      }),
      negativeSample(common, {
        method: `emitDifferentChannel${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "void",
        body: ["const list = this.listeners.get('other-channel') || [];", "for (const callback of list) { callback(payload); }"],
        endpointText: "The emitted channel is fixed to a different key and must not be matched to arbitrary registration.",
        negativeReason: "event_channel_mismatch",
        family: "E.module/event.negative-channel-mismatch",
      }),
    ],
    storage: () => [
      moduleSample(common, {
        method: `putSecret${tag}`,
        params: [{ name: "key", type: "string" }, { name: "value", type: "string" }],
        returnType: "void",
        body: ["Preferences.putSync(key, value);", "this.slots.set(key, value);"],
        role: "handoff",
        effectKinds: ["handoff.put"],
        endpoint: arg(1),
        endpointText: "Stores value into an exact persistent storage slot keyed by the first argument.",
        family: "F.module/storage.put",
      }),
      moduleSample(common, {
        method: `getSecret${tag}`,
        params: [{ name: "key", type: "string" }],
        returnType: "string",
        body: ["const value = this.slots.get(key) || Preferences.getSync(key, '');", "return value;"],
        role: "handoff",
        effectKinds: ["handoff.get"],
        endpoint: ret(),
        endpointText: "Reads the same persistent storage slot keyed by the first argument.",
        family: "F.module/storage.get",
      }),
      moduleSample(common, {
        method: `removeSecret${tag}`,
        params: [{ name: "key", type: "string" }],
        returnType: "void",
        body: ["this.slots.delete(key);", "Preferences.deleteSync(key);"],
        role: "handoff",
        effectKinds: ["handoff.kill"],
        endpoint: arg(0),
        endpointText: "Kills the persistent storage slot for the key.",
        family: "F.module/storage.kill",
      }),
      moduleSample(common, {
        method: `setReactiveState${tag}`,
        params: [{ name: "value", type: "string" }],
        returnType: "void",
        body: ["AppStorage.SetOrCreate('session', value);", "this.stateValue = value;"],
        role: "handoff",
        effectKinds: ["handoff.put"],
        endpoint: arg(0),
        endpointText: "Writes a reactive-state slot named session.",
        family: "F.module/storage.reactive-put",
      }),
      moduleSample(common, {
        method: `requestWithReceiverSecret${tag}`,
        returnType: "void",
        body: ["this.requestHeaders = { Authorization: this.options.secret };", "HttpClient.request({ headers: this.requestHeaders });"],
        role: "handoff",
        effectKinds: ["handoff.put", "handoff.get"],
        endpoint: receiverPath(["options", "secret"]),
        endpointText: "this.options.secret is moved into this.requestHeaders and then consumed by a request.",
        family: "F.module/storage.object-field-receiver-carrier",
      }),
      negativeSample(common, {
        method: `getOtherKey${tag}`,
        params: [{ name: "key", type: "string" }],
        returnType: "string",
        body: ["const value = this.slots.get(key + '-other') || '';", "return value;"],
        endpointText: "The read key does not match the put key layout.",
        negativeReason: "storage_key_mismatch",
        family: "F.module/storage.negative-key-mismatch",
      }),
    ],
    router: () => [
      moduleSample(common, {
        method: `pushWithToken${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "void",
        body: ["Router.pushUrl({ url: 'pages/Detail', params: { token: token } });"],
        role: "handoff",
        effectKinds: ["handoff.put"],
        endpoint: arg(0),
        endpointText: "Writes token into a navigation-param slot.",
        family: "G.module/router.put",
      }),
      moduleSample(common, {
        method: `readRouteToken${tag}`,
        returnType: "string",
        body: ["const params = Router.getParams() as Record<string, string>;", "return params.token;"],
        role: "handoff",
        effectKinds: ["handoff.get"],
        endpoint: ret(),
        endpointText: "Reads token from the navigation-param slot.",
        family: "G.module/router.get",
      }),
      moduleSample(common, {
        method: `submitPromiseTask${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "Promise<string>",
        body: ["return TaskPool.execute((): string => payload);"],
        role: "handoff",
        effectKinds: ["handoff.put", "handoff.get"],
        endpoint: promiseResult(),
        endpointText: "The async task result carries the submitted payload through an async-result slot.",
        family: "G.module/promise-taskpool.result",
      }),
      moduleSample(common, {
        method: `registerLaterCallback${tag}`,
        params: [{ name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["this.laterCallback = callback;"],
        role: "handoff",
        effectKinds: ["handoff.put"],
        endpoint: arg(0),
        endpointText: "Registers a callback into receiver state for later activation.",
        family: "G.module/callback-registration.put",
      }),
      needMoreSample(common, {
        method: `registerOnlyNoTrigger${tag}`,
        params: [{ name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["this.laterCallback = callback;"],
        endpointText: "Only registration is shown; no trigger evidence proves payload propagation.",
        negativeReason: "registration_without_trigger_evidence",
        family: "G.module/callback-registration.need-more-trigger",
      }),
      negativeSample(common, {
        method: `pushRouteNameOnly${tag}`,
        params: [{ name: "routeName", type: "string" }],
        returnType: "void",
        body: ["Router.pushUrl({ url: routeName, params: { mode: 'view' } });"],
        endpointText: "The route name is destination metadata, not a payload navigation sink in this dataset.",
        negativeReason: "router_destination_metadata_not_payload",
        family: "G.module/router.negative-route-name",
      }),
    ],
    worker: () => [
      moduleSample(common, {
        method: `postWorkerJob${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "void",
        body: ["WorkerClient.postMessage({ payload: payload });"],
        role: "handoff",
        effectKinds: ["handoff.put"],
        endpoint: arg(0),
        endpointText: "Posts payload into a worker message slot.",
        family: "G.module/worker.put",
      }),
      moduleSample(common, {
        method: `onWorkerResult${tag}`,
        params: [{ name: "callback", type: "(payload: string) => void" }],
        returnType: "void",
        body: ["WorkerClient.onMessage((event: Record<string, string>) => { callback(event.payload); });"],
        role: "handoff",
        effectKinds: ["handoff.get"],
        endpoint: callbackArg(0, 0),
        endpointText: "Receives worker result payload and forwards it to callback argument 0.",
        family: "G.module/worker.get",
      }),
      moduleSample(common, {
        method: `runTaskpoolJob${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "Promise<string>",
        body: ["return taskpool.execute((): string => payload);"],
        role: "handoff",
        effectKinds: ["handoff.put", "handoff.get"],
        endpoint: promiseResult(),
        endpointText: "Taskpool returns the submitted payload through an async-result slot.",
        family: "G.module/taskpool.result",
      }),
      apiSample(common, {
        method: `cancelWorkerSlot${tag}`,
        params: [{ name: "jobId", type: "string" }],
        returnType: "void",
        body: ["WorkerClient.terminate(jobId);", "this.slots.delete(jobId);"],
        role: "handoff",
        expectedPlane: "module",
        effectKinds: ["handoff.kill"],
        endpoint: arg(0),
        endpointText: "Terminates the worker slot for the job id.",
        family: "G.module/worker.kill",
      }),
      needMoreSample(common, {
        method: `postWithoutResultReader${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "void",
        body: ["WorkerClient.postMessage({ payload: payload });"],
        endpointText: "The send side alone lacks companion result evidence.",
        negativeReason: "worker_put_without_get_evidence",
        family: "G.module/worker.need-more-companion",
      }),
      negativeSample(common, {
        method: `postControlOnly${tag}`,
        params: [{ name: "jobType", type: "string" }],
        returnType: "void",
        body: ["WorkerClient.postMessage({ command: jobType, payload: 'fixed' });"],
        endpointText: "The argument selects a command type and is not the worker payload.",
        negativeReason: "worker_control_metadata_not_payload",
        family: "G.module/worker.negative-control",
      }),
    ],
    complex: () => [
      apiSample(common, {
        method: `trackAnalytics${tag}`,
        params: [{ name: "eventName", type: "string" }, { name: "payload", type: "Record<string, string>" }],
        returnType: "void",
        body: ["LocalVendorAnalytics.track(eventName, { ...payload });"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(1),
        endpointText: "The payload object is sent to an unfamiliar third-party analytics SDK.",
        family: "I.complex/vendor-analytics-sink",
      }),
      apiSample(common, {
        method: `onChatMessage${tag}`,
        params: [{ name: "callback", type: "(message: string) => void" }],
        returnType: "void",
        body: ["ChatSdk.onMessage((message: string) => { callback(message); });"],
        role: "source",
        effectKinds: ["rule.source"],
        endpoint: callbackArg(0, 0),
        endpointText: "The unfamiliar ChatSdk callback introduces external message payloads.",
        family: "I.complex/chat-sdk-callback-source",
      }),
      apiSample(common, {
        method: `createPaymentOrder${tag}`,
        params: [{ name: "order", type: "Record<string, string>" }],
        returnType: "Promise<string>",
        body: ["return PaymentClient.createOrder({ ...order });"],
        role: "sink",
        effectKinds: ["rule.sink"],
        endpoint: arg(0),
        endpointText: "The order object is sent to a payment SDK boundary.",
        family: "I.complex/payment-order-sink",
      }),
      apiSample(common, {
        method: `wrapVendorToken${tag}`,
        params: [{ name: "token", type: "string" }],
        returnType: "Record<string, string>",
        body: ["const wrapped = VendorCodec.wrap({ token: token });", "return wrapped;"],
        role: "transfer",
        effectKinds: ["rule.transfer"],
        endpoint: retPath(["token"]),
        expectedBindings: [{ role: "transfer", endpoint: retPath(["token"]), effectKind: "rule.transfer", from: arg(0), to: retPath(["token"]) }],
        endpointText: "The token argument is wrapped into the returned object field.",
        family: "I.complex/object-shape-transfer",
      }),
      negativeSample(common, {
        method: `trackEventNameOnly${tag}`,
        params: [{ name: "eventName", type: "string" }],
        returnType: "void",
        body: ["LocalVendorAnalytics.track(eventName, { status: 'ok' });"],
        endpointText: "The event name is analytics control metadata, not payload disclosure.",
        negativeReason: "third_party_control_metadata_not_payload",
        family: "I.complex/negative-event-name-only",
      }),
      needMoreSample(common, {
        method: `callUnknownOverload${tag}`,
        params: [{ name: "payload", type: "string" }],
        returnType: "void",
        body: ["VendorUnknown.call(payload);", "VendorUnknown.call('control', payload);"],
        endpointText: "Same-named unknown overload-like calls require exact companion surface evidence before modeling.",
        negativeReason: "overload_like_ambiguous_endpoint",
        family: "I.complex/need-more-overload-like",
      }),
    ],
  };
  const samples = builders[family]();
  samples.push(negativeSample(common, {
    method: `normalizeDisplayValue${tag}`,
    params: [{ name: "value", type: "string" }],
    returnType: "string",
    body: ["const display = String(value).toLowerCase();", "return 'len=' + display.length;"],
    endpointText: "Display normalization keeps only derived presentation metadata and must not become a semantic asset.",
    negativeReason: "display_formatting_without_preserved_security_semantics",
    family: `${scenarioFamilyLabel(family)}.negative-display-formatting`,
  }));
  return samples;
}

function apiSample(common, input) {
  return {
    ...common,
    params: input.params || [],
    method: input.method,
    returnType: input.returnType,
    body: input.body,
    expectedDecision: input.expectedDecision || "done",
    expectedPlane: input.expectedPlane || "rule",
    expectedSemanticRole: input.role,
    expectedEffectKinds: input.effectKinds,
    expectedEndpoint: input.endpoint,
    expectedBindings: input.expectedBindings || [{
      role: input.role,
      endpoint: input.endpoint,
      effectKind: input.effectKinds[0],
    }],
    expectedEndpointSemantics: input.endpointText,
    negativeReason: null,
    scenarioFamily: input.family,
    complexityLevel: input.family.startsWith("I.") ? "complex" : undefined,
    semanticFocus: input.semanticFocus,
  };
}

function moduleSample(common, input) {
  return apiSample(common, {
    ...input,
    expectedPlane: "module",
    role: input.role || "handoff",
  });
}

function negativeSample(common, input) {
  return {
    ...common,
    params: input.params || [],
    method: input.method,
    returnType: input.returnType,
    body: input.body,
    expectedDecision: "reject",
    expectedPlane: null,
    expectedSemanticRole: "none",
    expectedEffectKinds: [],
    expectedEndpoint: null,
    expectedBindings: [],
    expectedEndpointSemantics: input.endpointText,
    negativeReason: input.negativeReason,
    scenarioFamily: input.family,
    complexityLevel: "negative",
  };
}

function needMoreSample(common, input) {
  return {
    ...negativeSample(common, input),
    expectedDecision: "need-more-evidence",
  };
}

function writeScenarioProject(scenario) {
  const scenarioRoot = path.join(datasetRoot, "scenarios", scenario.scenarioId);
  const projectRoot = path.join(scenarioRoot, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  writeFile(path.join(projectRoot, scenario.fileRel), buildScenarioClassSource(scenario));
  writeFile(path.join(projectRoot, "entry/src/main/ets/pages", `${scenario.pageName}.ets`), buildScenarioPageSource(scenario));
  if (scenario.includeAbility) {
    writeFile(path.join(projectRoot, "entry/src/main/ets/entryability", `${scenario.abilityName}.ets`), buildAbilitySource(scenario));
  }
  writeFile(path.join(projectRoot, "entry/src/main/ets/common/PlainHelper.ets"), buildPlainHelperSource(scenario));
  writeFile(path.join(scenarioRoot, "README.md"), [
    `# ${scenario.scenarioId}`,
    "",
    scenario.description,
    "",
    `Family: ${scenario.scenarioFamily}`,
    `Complexity: ${scenario.complexityLevel}`,
    "",
    "This project is a small ArkTS/Harmony-style scenario. It is intentionally synthetic, but all SemanticFlow slices are generated by the current ArkTaint scanner or ArkMain builder.",
  ].join("\n"));
}

function buildAbilitySource(scenario) {
  return [
    "import UIAbility from '@ohos.app.ability.UIAbility';",
    "import AbilityConstant from '@ohos.app.ability.AbilityConstant';",
    "import Want from '@ohos.app.ability.Want';",
    "import window from '@ohos.window';",
    "",
    `export default class ${scenario.abilityName} extends UIAbility {`,
    "  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {",
    "    const bundleName = want.bundleName;",
    "    void bundleName;",
    "  }",
    "",
    "  onWindowStageCreate(windowStage: window.WindowStage): void {",
    "    windowStage.loadContent('pages/Index');",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildScenarioClassSource(scenario) {
  const methods = scenario.samples.map(sample => methodSource(sample)).join("\n\n");
  return [
    externalStubs(),
    "",
    `export class ${scenario.className} {`,
    "  private cachedValue: string = 'cached-local';",
    "  private stateValue: string = '';",
    "  private requestHeaders: Record<string, string> = {};",
    "  private options: Record<string, string> = { secret: 'receiver-secret' };",
    "  private slots: Map<string, string> = new Map();",
    "  private listeners: Map<string, Array<(payload: string) => void>> = new Map();",
    "  private laterCallback: ((payload: string) => void) | undefined;",
    "",
    methods,
    "}",
    "",
  ].join("\n");
}

function externalStubs() {
  return [
    "declare const NativeDevice: { readDeviceId(): string };",
    "declare const AuthBridge: { requestAccessToken(): string };",
    "declare const AccountBridge: { readUserProfile(): Record<string, string> };",
    "declare const NativeChat: { listen(callback: (payload: string) => void): void };",
    "declare const provider: { get(): string };",
    "declare const HttpClient: { post(url: string, body: string): void; request(options: Record<string, Object>): void };",
    "declare const FileClient: { write(path: string, content: string): void };",
    "declare const RdbClient: { insert(table: string, record: string): void };",
    "declare const Crypto: { sha256(value: string): string };",
    "declare const Preferences: { putSync(key: string, value: string): void; getSync(key: string, defaultValue: string): string; deleteSync(key: string): void };",
    "declare const AppStorage: { SetOrCreate(key: string, value: string): void; Get(key: string): string };",
    "declare const Router: { pushUrl(options: Record<string, Object>): void; getParams(): Object };",
    "declare const TaskPool: { execute(task: () => string): Promise<string> };",
    "declare const taskpool: { execute(task: () => string): Promise<string> };",
    "declare const WorkerClient: { postMessage(message: Record<string, Object>): void; onMessage(callback: (event: Record<string, string>) => void): void; terminate(jobId: string): void };",
    "declare const LocalVendorAnalytics: { track(eventName: string, payload: Record<string, string>): void };",
    "declare const ChatSdk: { onMessage(callback: (message: string) => void): void };",
    "declare const PaymentClient: { createOrder(order: Record<string, string>): Promise<string> };",
    "declare const VendorCodec: { wrap(value: Record<string, string>): Record<string, string> };",
    "declare const VendorUnknown: { call(value: string): void; call(name: string, value: string): void };",
  ].join("\n");
}

function methodSource(sample) {
  const params = sample.params.map(param => `${param.name}: ${param.type}`).join(", ");
  const bodyLines = sample.body.map(line => `    ${line}`);
  return [
    `  ${sample.method}(${params}): ${sample.returnType} {`,
    ...bodyLines,
    "  }",
  ].join("\n");
}

function buildScenarioPageSource(scenario) {
  const classImport = `../${scenario.dir}/${scenario.className}`.replace(/\\/g, "/");
  const calls = scenario.samples.slice(0, 6).map(sample => `    ${callStatement(sample)}`);
  return [
    `import { ${scenario.className} } from '${classImport}';`,
    "import { PlainHelper } from '../common/PlainHelper';",
    "",
    "@Entry",
    "@Component",
    `export struct ${scenario.pageName} {`,
    `  private kit: ${scenario.className} = new ${scenario.className}();`,
    "  private lastPayload: string = '';",
    "",
    "  aboutToAppear(): void {",
    ...calls,
    "    const label = PlainHelper.formatPlainLabel('screen');",
    "    this.lastPayload = label;",
    "  }",
    "",
    "  onPageShow(): void {",
    "    this.lastPayload = 'visible';",
    "  }",
    "",
    "  build() {",
    "  }",
    "}",
    "",
  ].join("\n");
}

function callStatement(sample) {
  const args = sample.params.map(param => dummyArg(param)).join(", ");
  const call = `this.kit.${sample.method}(${args})`;
  if (sample.returnType === "void") return `${call};`;
  if (sample.returnType.startsWith("Promise<")) return `${call}.then((value: string) => { this.lastPayload = value; });`;
  return `this.lastPayload = String(${call});`;
}

function dummyArg(param) {
  const type = String(param.type || "");
  if (type.includes("=>")) {
    return "(payload: string): void => { this.lastPayload = payload; }";
  }
  if (type.startsWith("Record<")) return "{ token: 'tok', secret: 'sec', id: 'id' }";
  if (type === "number") return "1";
  return `'${param.name}-value'`;
}

function buildPlainHelperSource(scenario) {
  const method = scenario.engineNotSelected[0].method;
  return [
    "export class PlainHelper {",
    `  static ${method}(name: string): string {`,
    "    return 'label-' + name;",
    "  }",
    "}",
    "",
  ].join("\n");
}

function selectCandidate(candidates, spec) {
  const expectedFile = normalizePath(spec.sourceFile);
  const matches = candidates.filter(candidate =>
    candidate.method === spec.method && normalizePath(candidate.sourceFile) === expectedFile);
  if (matches.length === 0) return undefined;
  if (spec.semanticFocus) {
    const focused = matches.find(candidate => String(candidate.semanticFocus || "") === spec.semanticFocus);
    if (focused) return focused;
  }
  if (spec.expectedSemanticRole === "source") {
    const returned = matches.find(candidate => String(candidate.semanticFocus || "") === "returned_value_surface");
    if (returned) return returned;
  }
  return matches[0];
}

function buildArkMainSamples(scenario, projectDir, counters) {
  const records = [];
  const llmRequests = [];
  const gaps = [];
  let candidates = [];
  try {
    const scene = buildScene(projectDir);
    candidates = buildArkMainEntryCandidates(scene, { maxCandidates: 16 });
  } catch (error) {
    gaps.push({
      scenarioId: scenario.scenarioId,
      reason: "arkmain-scene-build-failed",
      error: String(error && error.message || error),
    });
    return { records, llmRequests, gaps };
  }
  const expected = [
    {
      methodName: "aboutToAppear",
      className: scenario.pageName,
      sourceFile: `entry/src/main/ets/pages/${scenario.pageName}.ets`,
      fileSuffix: `/pages/${scenario.pageName}.ets`,
      prefix: "SF332-ARKMAIN-LIFECYCLE",
      role: "entry",
      effectKind: "entry.lifecycle",
      family: "H.arkmain/component-lifecycle",
      semantics: "aboutToAppear is a framework-managed ArkUI lifecycle entry surface.",
    },
    {
      methodName: "build",
      className: scenario.pageName,
      sourceFile: `entry/src/main/ets/pages/${scenario.pageName}.ets`,
      fileSuffix: `/pages/${scenario.pageName}.ets`,
      prefix: "SF332-ARKMAIN-BUILD",
      role: "build",
      effectKind: "entry.frameworkInvoke",
      family: "H.arkmain/component-build",
      semantics: "@Entry/@Component build is a framework-managed render entry surface.",
    },
    ...(scenario.includeAbility ? [
      {
        methodName: "onCreate",
        className: scenario.abilityName,
        sourceFile: `entry/src/main/ets/entryability/${scenario.abilityName}.ets`,
        fileSuffix: `/entryability/${scenario.abilityName}.ets`,
        prefix: "SF332-ARKMAIN-ABILITY",
        role: "entry",
        effectKind: "entry.lifecycle",
        family: "H.arkmain/ability-onCreate",
        semantics: "Ability onCreate is a framework-managed Ability lifecycle entry surface.",
      },
      {
        methodName: "onWindowStageCreate",
        className: scenario.abilityName,
        sourceFile: `entry/src/main/ets/entryability/${scenario.abilityName}.ets`,
        fileSuffix: `/entryability/${scenario.abilityName}.ets`,
        prefix: "SF332-ARKMAIN-ABILITY",
        role: "entry",
        effectKind: "entry.lifecycle",
        family: "H.arkmain/ability-onWindowStageCreate",
        semantics: "Ability onWindowStageCreate is a framework-managed window-stage lifecycle entry surface.",
      },
    ] : []),
  ];
  for (const expectedEntry of expected) {
    const methodName = expectedEntry.methodName;
    const sampleId = nextSampleId(counters, expectedEntry.prefix);
    const candidate = candidates.find(item =>
      item.methodName === methodName && normalizePath(item.filePath || "").endsWith(expectedEntry.fileSuffix));
    const sourceFile = expectedEntry.sourceFile;
    const spec = {
      method: methodName,
      sourceFile,
      expectedDecision: "done",
      expectedPlane: "arkmain",
      expectedSemanticRole: expectedEntry.role,
      expectedEffectKinds: [expectedEntry.effectKind],
      expectedEndpoint: null,
      expectedBindings: [{
        role: "entry",
        endpoint: null,
        effectKind: expectedEntry.effectKind,
      }],
      expectedEndpointSemantics: expectedEntry.semantics,
      negativeReason: null,
      scenarioFamily: expectedEntry.family,
      complexityLevel: scenario.complexityLevel,
      className: expectedEntry.className,
    };
    if (!candidate) {
      const record = writeNotReadyRecord({
        sampleId,
        scenario,
        spec,
        reason: "arkmain-candidate-not-selected",
        candidates,
      });
      records.push(record);
      gaps.push({
        sampleId,
        scenarioId: scenario.scenarioId,
        method: methodName,
        reason: "ArkMain builder did not produce expected entry candidate",
      });
      continue;
    }
    const item = buildSemanticFlowArkMainCandidateItem(candidate);
    const record = writeReadyRecord({
      sampleId,
      scenario,
      spec,
      item,
      candidate,
      sourceKind: "arkmain",
    });
    records.push(record);
    llmRequests.push(record.llmRequest);
  }
  return { records, llmRequests, gaps };
}

function buildScene(projectDir) {
  const config = new SceneConfig();
  config.buildFromProjectDir(projectDir);
  const scene = new Scene();
  scene.buildSceneFromProjectDir(config);
  scene.inferTypes();
  return scene;
}

function writeReadyRecord({ sampleId, scenario, spec, item, candidate, sourceKind }) {
  const anchor = sanitizeAnchor(item.anchor);
  const slice = item.initialSlice;
  const prompt = buildSemanticFlowPrompt({
    anchor: item.anchor,
    draftId: `draft.${sampleId}`,
    slice,
    round: 0,
    history: [],
  });
  const sliceRel = `slices/${sampleId}.slice.json`;
  const promptRel = `prompts/${sampleId}.prompt.json`;
  const oracleRel = `oracle/${sampleId}.oracle.json`;
  const sourceFiles = [`scenarios/${scenario.scenarioId}/project/${normalizePath(spec.sourceFile)}`];
  const slicePayload = {
    sampleId,
    scenarioId: scenario.scenarioId,
    generatedAt: GENERATED_AT,
    engineGenerated: true,
    sourceKind,
    engineCandidateSummary: summarizeCandidate(candidate),
    anchor,
    initialSlice: slice,
  };
  const promptPayload = {
    sampleId,
    scenarioId: scenario.scenarioId,
    generatedAt: GENERATED_AT,
    promptSource: "buildSemanticFlowPrompt",
    draftId: `draft.${sampleId}`,
    system: prompt.system,
    user: prompt.user,
  };
  const oracle = buildOracle({
    sampleId,
    scenario,
    spec,
    sourceFiles,
    sliceRel,
    promptRel,
    canonicalApiId: anchor.canonicalApiId,
    sliceTemplate: slice.template,
    llmReady: true,
  });
  writeJson(path.join(datasetRoot, sliceRel), slicePayload);
  writeJson(path.join(datasetRoot, promptRel), promptPayload);
  writeJson(path.join(datasetRoot, oracleRel), oracle);

  const llmRequest = {
    sampleId,
    profileReady: true,
    recommendedProfile: RECOMMENDED_PROFILE,
    system: prompt.system,
    user: prompt.user,
    oraclePath: oracleRel,
    slicePath: sliceRel,
    promptPath: promptRel,
  };
  return {
    sampleId,
    scenarioId: scenario.scenarioId,
    sourceFiles,
    engineCandidateSummary: summarizeCandidate(candidate),
    anchor,
    slice,
    promptRef: promptRel,
    oracleRef: oracleRel,
    expected: expectedSummary(spec),
    planeOracle: spec.expectedPlane,
    roleOracle: spec.expectedSemanticRole,
    expectedDecision: spec.expectedDecision,
    effectKindsOracle: spec.expectedEffectKinds,
    complexityLevel: spec.complexityLevel || scenario.complexityLevel,
    scenarioFamily: spec.scenarioFamily || scenario.scenarioFamily,
    sliceTemplate: slice.template,
    sourceProjectDir: `scenarios/${scenario.scenarioId}/project`,
    slicePath: sliceRel,
    promptPath: promptRel,
    oraclePath: oracleRel,
    llmReady: true,
    negativeType: spec.negativeReason || "",
    manualOracleStatus: "checked",
    isNegative: spec.expectedDecision !== "done",
    llmRequest,
  };
}

function writeNotReadyRecord({ sampleId, scenario, spec, reason, candidates }) {
  const oracleRel = `oracle/${sampleId}.oracle.json`;
  const sourceFiles = [`scenarios/${scenario.scenarioId}/project/${normalizePath(spec.sourceFile)}`];
  const oracle = buildOracle({
    sampleId,
    scenario,
    spec,
    sourceFiles,
    sliceRel: null,
    promptRel: null,
    canonicalApiId: null,
    sliceTemplate: null,
    llmReady: false,
    notReadyReason: reason,
  });
  writeJson(path.join(datasetRoot, oracleRel), oracle);
  return {
    sampleId,
    scenarioId: scenario.scenarioId,
    sourceFiles,
    engineCandidateSummary: {
      selected: false,
      reason,
      availableCandidates: Array.isArray(candidates) ? candidates.slice(0, 12).map(summarizeCandidate) : [],
    },
    anchor: null,
    slice: null,
    promptRef: null,
    oracleRef: oracleRel,
    expected: expectedSummary(spec),
    planeOracle: spec.expectedPlane,
    roleOracle: spec.expectedSemanticRole,
    expectedDecision: spec.expectedDecision,
    effectKindsOracle: spec.expectedEffectKinds || [],
    complexityLevel: spec.complexityLevel || scenario.complexityLevel,
    scenarioFamily: spec.scenarioFamily || scenario.scenarioFamily,
    sliceTemplate: "",
    sourceProjectDir: `scenarios/${scenario.scenarioId}/project`,
    slicePath: "",
    promptPath: "",
    oraclePath: oracleRel,
    llmReady: false,
    negativeType: spec.negativeReason || reason,
    manualOracleStatus: "checked",
    isNegative: true,
  };
}

function buildOracle(input) {
  const { sampleId, scenario, spec, sourceFiles, sliceRel, promptRel, canonicalApiId, sliceTemplate, llmReady, notReadyReason } = input;
  return {
    sampleId,
    scenarioId: scenario.scenarioId,
    sourceFiles,
    engineSlicePath: sliceRel,
    promptPath: promptRel,
    llmReady,
    notReadyReason: notReadyReason || null,
    expectedDecision: spec.expectedDecision,
    expectedPlane: spec.expectedPlane,
    expectedSemanticRole: spec.expectedSemanticRole,
    expectedEffectKinds: spec.expectedEffectKinds || [],
    expectedSurface: spec.expectedPlane ? {
      kind: spec.expectedPlane === "arkmain" ? "entry" : "invoke",
      canonicalApiIdFromSlice: !!canonicalApiId,
      canonicalApiId,
      mustUseCanonicalApiSurface: true,
      sliceTemplate,
    } : null,
    expectedBindings: spec.expectedBindings || [],
    expectedEndpointSemantics: spec.expectedEndpointSemantics,
    mustNotContain: spec.expectedDecision === "done"
      ? OLD_IDENTITY_FIELDS
      : [...OLD_IDENTITY_FIELDS, "rule.source", "rule.sink", "handoff.put", "entry.lifecycle"],
    negativeReason: spec.negativeReason,
    manualOracleStatus: "checked",
    manualReviewNotes: llmReady
      ? "Oracle filled after inspecting the authored scenario source and the generated SemanticFlow slice identity/template fields in this build."
      : "Oracle records an engine-not-selected or not-ready negative after inspecting the scenario source and scanner selection result.",
  };
}

function expectedSummary(spec) {
  return {
    decision: spec.expectedDecision,
    plane: spec.expectedPlane,
    role: spec.expectedSemanticRole,
    effectKinds: spec.expectedEffectKinds || [],
    endpoint: spec.expectedEndpoint || null,
    negativeReason: spec.negativeReason,
  };
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  const methodText = typeof candidate.methodName === "string"
    ? candidate.methodName
    : (typeof candidate.method === "string" ? candidate.method : "");
  return {
    method: methodText,
    sourceFile: normalizePath(candidate.sourceFile || candidate.filePath || ""),
    canonicalApiId: candidate.canonicalApiId || "",
    candidateOrigin: candidate.candidateOrigin || "",
    semanticFocus: candidate.semanticFocus || "",
    typeHint: candidate.typeHint || "",
    argCount: candidate.argCount,
    returnType: candidate.returnType || "",
    contextSliceCount: Array.isArray(candidate.contextSlices) ? candidate.contextSlices.length : undefined,
    topEntries: candidate.topEntries || candidate.ownerSignals || [],
  };
}

function writeManifests(records, llmRequests, gaps) {
  const csvHeader = [
    "sample_id",
    "scenario_id",
    "plane_oracle",
    "role_oracle",
    "expected_decision",
    "effect_kinds_oracle",
    "complexity_level",
    "scenario_family",
    "slice_template",
    "source_project_dir",
    "slice_path",
    "prompt_path",
    "oracle_path",
    "llm_ready",
    "negative_type",
    "manual_oracle_status",
  ];
  const csvRows = records.map(record => [
    record.sampleId,
    record.scenarioId,
    record.planeOracle || "",
    record.roleOracle || "",
    record.expectedDecision,
    (record.effectKindsOracle || []).join(";"),
    record.complexityLevel,
    record.scenarioFamily,
    record.sliceTemplate,
    record.sourceProjectDir,
    record.slicePath,
    record.promptPath,
    record.oraclePath,
    String(record.llmReady),
    record.negativeType,
    record.manualOracleStatus,
  ]);
  writeFile(path.join(datasetRoot, "semanticflow_332_manifest.csv"), [
    csvHeader.map(csvCell).join(","),
    ...csvRows.map(row => row.map(csvCell).join(",")),
  ].join("\n") + "\n");
  writeFile(path.join(datasetRoot, "semanticflow_332_manifest.jsonl"),
    records.map(record => JSON.stringify({
      sampleId: record.sampleId,
      scenarioId: record.scenarioId,
      sourceFiles: record.sourceFiles,
      engineCandidateSummary: record.engineCandidateSummary,
      anchor: record.anchor,
      slice: record.slice,
      promptRef: record.promptRef,
      oracleRef: record.oracleRef,
      expected: record.expected,
      llmReady: record.llmReady,
    })).join("\n") + "\n");
  writeFile(path.join(datasetRoot, "llm_requests.jsonl"), llmRequests.map(request => JSON.stringify(request)).join("\n") + "\n");
  writeJson(path.join(datasetRoot, "engine_gaps.json"), gaps);
}

function validateDataset(records, llmRequests) {
  const errors = [];
  const warnings = [];
  const llmReady = records.filter(record => record.llmReady);
  const negativeReady = llmReady.filter(record => record.expectedDecision !== "done");
  if (llmReady.length < REQUIRED_LLM_READY) {
    errors.push(`llmReady ${llmReady.length} is below required ${REQUIRED_LLM_READY}`);
  }
  const ratio = llmReady.length ? negativeReady.length / llmReady.length : 0;
  if (ratio < REQUIRED_NEGATIVE_RATIO) {
    errors.push(`negative llm-ready ratio ${ratio.toFixed(3)} is below required ${REQUIRED_NEGATIVE_RATIO}`);
  }
  for (const record of records) {
    const oraclePath = path.join(datasetRoot, record.oraclePath);
    if (!fs.existsSync(oraclePath)) errors.push(`missing oracle ${record.oraclePath}`);
    if (record.llmReady) {
      for (const required of [record.slicePath, record.promptPath]) {
        if (!required || !fs.existsSync(path.join(datasetRoot, required))) {
          errors.push(`missing ready artifact ${record.sampleId}:${required}`);
        }
      }
    }
  }
  const requestIds = new Set();
  for (const request of llmRequests) {
    if (!request.sampleId || !request.system || !request.user || !request.oraclePath || !request.slicePath) {
      errors.push(`invalid llm request ${request.sampleId || "<missing>"}`);
      continue;
    }
    requestIds.add(request.sampleId);
    if (!fs.existsSync(path.join(datasetRoot, request.oraclePath))) {
      errors.push(`llm request oracle missing ${request.sampleId}`);
    }
    if (!fs.existsSync(path.join(datasetRoot, request.slicePath))) {
      errors.push(`llm request slice missing ${request.sampleId}`);
    }
  }
  for (const record of llmReady) {
    if (!requestIds.has(record.sampleId)) {
      errors.push(`llm-ready sample missing request ${record.sampleId}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    llmReady: llmReady.length,
    negativeReady: negativeReady.length,
    negativeReadyRatio: ratio,
  };
}

function writeSummary(records, gaps, validation, scenarioCount) {
  const llmReady = records.filter(record => record.llmReady);
  const byPlane = countBy(llmReady, record => record.planeOracle || "negative");
  const byRole = countBy(llmReady, record => record.roleOracle || "none");
  const byDecision = countBy(llmReady, record => record.expectedDecision);
  const byComplexity = countBy(llmReady, record => record.complexityLevel || "unknown");
  const byTemplate = countBy(llmReady, record => record.sliceTemplate || "none");
  const byFamily = countBy(llmReady, record => record.scenarioFamily || "unknown");
  const notReady = records.filter(record => !record.llmReady);
  const lines = [
    "# SemanticFlow 3.3.2 Dataset Summary",
    "",
    `Generated at: ${GENERATED_AT}`,
    `Scenario count: ${scenarioCount}`,
    `Total samples: ${records.length}`,
    `LLM-ready samples: ${llmReady.length}`,
    `Negative LLM-ready samples: ${validation.negativeReady}`,
    `Negative LLM-ready ratio: ${validation.negativeReadyRatio.toFixed(3)}`,
    `Engine-not-ready samples: ${notReady.length}`,
    `Engine gaps recorded: ${gaps.length}`,
    "",
    "## Distribution By Plane",
    tableFromCounts(byPlane),
    "",
    "## Distribution By Role",
    tableFromCounts(byRole),
    "",
    "## Distribution By Decision",
    tableFromCounts(byDecision),
    "",
    "## Distribution By Complexity",
    tableFromCounts(byComplexity),
    "",
    "## Distribution By Slice Template",
    tableFromCounts(byTemplate),
    "",
    "## Distribution By Scenario Family",
    tableFromCounts(byFamily),
    "",
    "## LLM-Ready Policy",
    "",
    "- Every LLM-ready sample has an engine-generated SemanticFlow slice JSON.",
    "- Every LLM-ready prompt JSON is generated by buildSemanticFlowPrompt.",
    "- llm_requests.jsonl contains the system/user prompt pair for automatic runner submission.",
    "- This build does not call any LLM profile.",
    "",
    "## Gaps",
    "",
    gaps.length
      ? gaps.slice(0, 80).map(gap => `- ${gap.sampleId || gap.scenarioId}: ${gap.reason}`).join("\n")
      : "No engine gap was observed for the required LLM-ready threshold.",
    "",
  ];
  writeFile(path.join(datasetRoot, "semanticflow_332_summary.md"), lines.join("\n"));
}

function writeReusablePromptTemplate() {
  const content = [
    "# SemanticFlow 3.3.2 Reusable Prompt Template",
    "",
    "The per-sample prompts in this dataset are not hand-copied. They are generated by ArkTaint's `buildSemanticFlowPrompt({ anchor, draftId, slice, round: 0, history: [] })` from each engine-generated SemanticFlow item.",
    "",
    "Workflow:",
    "",
    "1. `tools/chapter3/build_332_semanticflow_dataset.js` writes scenario source code and calls the current scanner or ArkMain builder.",
    "2. The builder writes `slices/<sample>.slice.json` and `prompts/<sample>.prompt.json`.",
    "3. `llm_requests.jsonl` stores the exact `system` and `user` strings for every LLM-ready sample.",
    "4. `tools/chapter3/run_332_semanticflow_llm_eval.js` reads `llm_requests.jsonl` and sends prompts automatically when `--execute` is explicitly provided.",
    "",
    "LLM output requirements:",
    "",
    "- JSON only.",
    "- No markdown fences.",
    "- Use only `done`, `need-more-evidence`, or `reject`.",
    "- `done.asset` must use the current asset schema: `id`, `plane`, `status`, `surfaces`, `bindings`, `effectTemplates`, `relations`, and `provenance`.",
    "- Surface identity must come from `canonicalApiSurface` evidence and must not use legacy identity fields.",
    "",
    "Future evaluation scripts should compare model output against oracle fields for plane, effect kind, endpoint, canonical surface identity, negative rejection, and need-more-evidence behavior.",
    "",
  ].join("\n");
  writeFile(path.join(datasetRoot, "reusable_prompt_template.md"), content);
}

function writeBuildLog(records, gaps, validation, scenarioCount) {
  const lines = [
    "# SemanticFlow 3.3.2 Build Log",
    "",
    `Generated at: ${GENERATED_AT}`,
    `Repository root: ${repoRoot}`,
    `Dataset root: ${datasetRoot}`,
    "",
    "## Inputs",
    "",
    "- Current out/core/semanticflow/ApiModelingCandidateScanner",
    "- Current out/core/semanticflow/SemanticFlowAdapters",
    "- Current out/core/semanticflow/SemanticFlowPrompt",
    "- Current out/core/entry/arkmain/llm/ArkMainEntryCandidateBuilder",
    "",
    "## Results",
    "",
    `- Scenario count: ${scenarioCount}`,
    `- Total manifest records: ${records.length}`,
    `- LLM-ready records: ${validation.llmReady}`,
    `- Negative LLM-ready records: ${validation.negativeReady}`,
    `- Engine gaps: ${gaps.length}`,
    "",
    "## Validation",
    "",
    validation.ok ? "- validation: pass" : "- validation: fail",
    ...validation.errors.map(error => `- error: ${error}`),
    ...validation.warnings.map(warning => `- warning: ${warning}`),
    "",
    "No LLM profile was invoked during this build.",
    "",
  ];
  writeFile(path.join(datasetRoot, "build_log.md"), lines.join("\n"));
}

function tableFromCounts(counts) {
  const rows = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  return ["| key | count |", "| --- | ---: |", ...rows.map(([key, count]) => `| ${key} | ${count} |`)].join("\n");
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function nextSampleId(counters, prefix) {
  const next = (counters.get(prefix) || 0) + 1;
  counters.set(prefix, next);
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function samplePrefix(spec) {
  if (spec.expectedDecision === "reject") return "SF332-NEG-REJECT";
  if (spec.expectedDecision === "need-more-evidence") return "SF332-NEG-NEEDMORE";
  if (spec.expectedPlane === "rule") return `SF332-RULE-${String(spec.expectedSemanticRole || "ROLE").toUpperCase()}`;
  if (spec.expectedPlane === "module") {
    const role = spec.scenarioFamily && spec.scenarioFamily.includes("event") ? "EVENT" : "HANDOFF";
    return `SF332-MODULE-${role}`;
  }
  if (spec.expectedPlane === "arkmain") return "SF332-ARKMAIN-ENTRY";
  return "SF332-SAMPLE";
}

function sanitizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return anchor;
  const { method, ...rest } = anchor;
  void method;
  return rest;
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^.*\/project\//, "");
}

function capitalize(value) {
  const text = String(value || "");
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function arg(index) {
  return { base: { kind: "arg", index } };
}

function argPath(index, accessPath) {
  return { base: { kind: "arg", index }, accessPath };
}

function ret() {
  return { base: { kind: "return" } };
}

function retPath(accessPath) {
  return { base: { kind: "return" }, accessPath };
}

function promiseResult() {
  return { base: { kind: "promiseResult" } };
}

function callbackArg(callbackIndex, argIndex) {
  return { base: { kind: "callbackArg", callback: { kind: "arg", index: callbackIndex }, argIndex } };
}

function receiverPath(accessPath) {
  return { base: { kind: "receiver" }, accessPath };
}

main();
