const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const defaultDatasetRoot = path.join(
  repoRoot,
  "internal_docs/reports/chapter3_experiment_artifacts/final/datasets/semanticflow_331_evidence_ablation",
);

const allowedProfiles = new Set([
  "deepseek-v4-pro",
  "qwen3.7-plus",
  "doubao-seed2.1",
  "mimo-v2.5-pro",
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetRoot = path.resolve(args.datasetRoot || defaultDatasetRoot);
  const requestPath = path.resolve(args.requests || path.join(datasetRoot, "requests", "llm_requests.jsonl"));
  const profile = String(args.llmProfile || "deepseek-v4-pro");
  const execute = args.execute === true;
  const limit = normalizeOptionalInt(args.limit);
  const offset = normalizeOptionalInt(args.offset) || 0;
  const variantFilter = args.variantId ? new Set(String(args.variantId).split(",").map(s => s.trim()).filter(Boolean)) : undefined;
  const sampleFilter = args.sampleId ? new Set(String(args.sampleId).split(",").map(s => s.trim()).filter(Boolean)) : undefined;
  const outputRoot = path.resolve(args.outputDir || path.join(
    repoRoot,
    "internal_docs/reports/chapter3_experiment_artifacts/final/runs/33_llm_asset_generation/evidence_ablation_331",
    `${profile}_${timestamp()}`,
  ));

  if (!allowedProfiles.has(profile)) {
    throw new Error(`unsupported --llmProfile ${profile}; allowed=${[...allowedProfiles].join(",")}`);
  }

  const allRequests = loadRequests(requestPath);
  const selectedRequests = selectRequests(allRequests, { limit, offset, variantFilter, sampleFilter });
  const validation = validateRequests(selectedRequests);
  const dryRunSummary = {
    mode: execute ? "execute" : "dry-run",
    datasetRoot: rel(datasetRoot),
    requestPath: rel(requestPath),
    outputRoot: rel(outputRoot),
    llmProfile: profile,
    totalRequestCount: allRequests.length,
    selectedRequestCount: selectedRequests.length,
    filters: {
      limit: limit ?? null,
      offset,
      variantId: variantFilter ? [...variantFilter] : null,
      sampleId: sampleFilter ? [...sampleFilter] : null,
    },
    validation,
  };

  if (!execute) {
    console.log(JSON.stringify(dryRunSummary, null, 2));
    return;
  }
  if (!validation.ok) {
    throw new Error(`request validation failed: ${validation.errors.join("; ")}`);
  }

  const {
    createSemanticFlowModelInvokerFromConfig,
  } = require(path.join(repoRoot, "out/cli/semanticflowLlmClient"));
  const {
    parseSemanticFlowAssetDecision,
  } = require(path.join(repoRoot, "out/core/semanticflow/SemanticFlowLlm"));

  const invoker = createSemanticFlowModelInvokerFromConfig({
    profile,
    timeoutMs: Number(args.timeoutMs || 120000),
    connectTimeoutMs: Number(args.connectTimeoutMs || 30000),
    maxAttempts: Number(args.transportMaxAttempts || args.maxTransportAttempts || 1),
  });
  if (!invoker) {
    throw new Error(`LLM profile is not available: ${profile}`);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const rawPath = path.join(outputRoot, "raw_records.jsonl");
  const recordsPath = path.join(outputRoot, "evaluated_records.jsonl");
  const metricsPath = path.join(outputRoot, "variant_metrics.csv");
  const summaryPath = path.join(outputRoot, "summary.md");
  const manifestPath = path.join(outputRoot, "run_manifest.json");

  writeJson(manifestPath, {
    ...dryRunSummary,
    startedAt: new Date().toISOString(),
    rawRecords: rel(rawPath),
    evaluatedRecords: rel(recordsPath),
    variantMetrics: rel(metricsPath),
    summary: rel(summaryPath),
    requestTimeoutMs: Number(args.timeoutMs || 120000),
    requestMaxAttempts: Number(args.requestMaxAttempts || args.maxAttempts || 1),
  });

  const evaluated = [];
  const requestAttempts = Number(args.requestMaxAttempts || args.maxAttempts || 1);
  for (let index = 0; index < selectedRequests.length; index++) {
    const request = selectedRequests[index];
    const oracle = loadJson(resolveRepoPath(request.oraclePath));
    const startedAt = Date.now();
    const result = await invokeWithRequestRetries({
      invoker,
      request,
      profile,
      parseSemanticFlowAssetDecision,
      maxAttempts: requestAttempts,
    });
    const elapsedMs = Date.now() - startedAt;
    const evaluation = evaluateDecision({
      request,
      oracle,
      raw: result.raw,
      parsed: result.parsed,
      parseError: result.parseError,
      invokeError: result.invokeError,
      elapsedMs,
      profile,
      attemptCount: result.attemptCount,
      attempts: result.attempts,
      skipped: result.skipped,
    });
    evaluated.push(evaluation);
    appendJsonl(rawPath, {
      requestId: request.requestId,
      sampleId: request.sampleId,
      variantId: request.variantId,
      profile,
      elapsedMs,
      raw: result.raw,
      parseError: result.parseError,
      invokeError: result.invokeError,
      attemptCount: result.attemptCount,
      attempts: result.attempts,
      skipped: result.skipped,
    });
    appendJsonl(recordsPath, evaluation);
    console.log(`331_eval progress=${index + 1}/${selectedRequests.length} request=${request.requestId} status=${evaluation.parsedStatus || "none"} strict=${evaluation.strictSemanticOk}`);
  }

  const metrics = buildVariantMetrics(evaluated);
  writeCsv(metricsPath, metrics);
  writeText(summaryPath, renderSummary({
    profile,
    requestPath,
    outputRoot,
    selectedRequests,
    evaluated,
    metrics,
  }));
  console.log(JSON.stringify({
    outputRoot,
    selectedRequestCount: selectedRequests.length,
    strictSemanticOk: evaluated.filter(row => row.strictSemanticOk).length,
    safeOrConservativeOk: evaluated.filter(row => row.safeOrConservativeOk).length,
    parseOk: evaluated.filter(row => row.parseOk).length,
    metricsPath,
    summaryPath,
  }, null, 2));
}

async function invokeWithRequestRetries({ invoker, request, profile, parseSemanticFlowAssetDecision, maxAttempts }) {
  const attempts = [];
  let lastRaw = "";
  let lastParsed;
  let lastParseError = "";
  let lastInvokeError = "";
  const count = Math.max(1, Number(maxAttempts || 1));
  for (let attempt = 1; attempt <= count; attempt++) {
    const startedAt = Date.now();
    let raw = "";
    let parsed;
    let parseError = "";
    let invokeError = "";
    try {
      raw = await invoker({
        system: request.system,
        user: request.user,
      });
      try {
        parsed = parseSemanticFlowAssetDecision(raw);
      } catch (error) {
        parseError = String(error && error.message || error);
      }
    } catch (error) {
      invokeError = String(error && error.message || error);
    }
    attempts.push({
      attempt,
      elapsedMs: Date.now() - startedAt,
      ok: !parseError && !invokeError,
      status: parsed && parsed.status,
      parseError,
      invokeError,
    });
    lastRaw = raw;
    lastParsed = parsed;
    lastParseError = parseError;
    lastInvokeError = invokeError;
    if (!parseError && !invokeError) {
      return {
        raw,
        parsed,
        parseError: "",
        invokeError: "",
        attemptCount: attempt,
        attempts,
        skipped: false,
      };
    }
    const errorText = String(invokeError || parseError || "unknown");
    console.log(`331_eval retry profile=${profile} request=${request.requestId} attempt=${attempt}/${count} error=${errorText.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  return {
    raw: lastRaw,
    parsed: lastParsed,
    parseError: lastParseError,
    invokeError: lastInvokeError,
    attemptCount: count,
    attempts,
    skipped: true,
  };
}

function evaluateDecision({ request, oracle, raw, parsed, parseError, invokeError, elapsedMs, profile, attemptCount, attempts, skipped }) {
  const parsedStatus = parsed && parsed.status || "";
  const expectedDecision = oracle.expectedDecision;
  const expectedPlane = oracle.expectedPlane;
  const expectedRole = oracle.expectedSemanticRole;
  const expectedEffectKinds = Array.isArray(oracle.expectedEffectKinds) ? oracle.expectedEffectKinds : [];
  const expectedEndpoint = oracle.expectedEndpoint || null;
  const expectedCanonicalApiId = oracle.engineCandidateSummary && oracle.engineCandidateSummary.canonicalApiId || "";
  const parseOk = Boolean(parsed) && !parseError && !invokeError;
  const statusMatch = parseOk && parsedStatus === expectedDecision;
  const asset = parsed && parsed.status === "done" ? parsed.asset : undefined;
  const planeCorrect = Boolean(asset) && asset.plane === expectedPlane;
  const roleCorrect = expectedRole === "none"
    ? parsedStatus === "reject"
    : Boolean(asset) && containsBindingRole(asset, expectedRole);
  const effectKindsCorrect = expectedEffectKinds.length === 0
    ? parsedStatus === "reject"
    : Boolean(asset) && expectedEffectKinds.every(kind => collectEffectKinds(asset).has(kind));
  const endpointCorrect = !expectedEndpoint
    ? true
    : Boolean(asset) && containsDeepEndpoint(asset, expectedEndpoint);
  const identityCorrect = !expectedCanonicalApiId
    ? true
    : Boolean(asset) && containsCanonicalApiId(asset, expectedCanonicalApiId);
  const forbiddenHits = collectForbiddenHits(parsed || raw, oracle.mustNotContain || []);
  const forbiddenClean = forbiddenHits.length === 0;
  const strictSemanticOk = expectedDecision === "reject"
    ? parseOk && parsedStatus === "reject" && forbiddenClean
    : parseOk && parsedStatus === "done" && planeCorrect && roleCorrect && effectKindsCorrect && endpointCorrect && identityCorrect && forbiddenClean;
  const safeOrConservativeOk = strictSemanticOk
    || (parseOk && expectedDecision === "done" && parsedStatus === "need-more-evidence" && forbiddenClean)
    || (parseOk && expectedDecision === "reject" && (parsedStatus === "reject" || parsedStatus === "need-more-evidence") && forbiddenClean);

  return {
    requestId: request.requestId,
    sampleId: request.sampleId,
    scenarioId: request.scenarioId,
    variantId: request.variantId,
    profile,
    elapsedMs,
    expectedDecision,
    expectedPlane,
    expectedRole,
    expectedEffectKinds: expectedEffectKinds.join(";"),
    expectedEndpoint: expectedEndpoint ? stableJson(expectedEndpoint) : "",
    parsedStatus,
    parseOk,
    statusMatch,
    planeCorrect,
    roleCorrect,
    effectKindsCorrect,
    endpointCorrect,
    identityCorrect,
    forbiddenClean,
    forbiddenHits: forbiddenHits.join(";"),
    strictSemanticOk,
    safeOrConservativeOk,
    parseError: parseError || "",
    invokeError: invokeError || "",
    attemptCount: attemptCount || 1,
    attempts: JSON.stringify(attempts || []),
    skipped: Boolean(skipped),
    oraclePath: request.oraclePath,
    slicePath: request.slicePath,
    promptPath: request.promptPath,
  };
}

function buildVariantMetrics(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.variantId)) groups.set(row.variantId, []);
    groups.get(row.variantId).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, items]) => {
    const count = items.length || 1;
    return {
      variant_id: variantId,
      request_count: items.length,
      parse_ok: sum(items, "parseOk"),
      parse_ok_rate: rate(sum(items, "parseOk"), count),
      status_match: sum(items, "statusMatch"),
      status_match_rate: rate(sum(items, "statusMatch"), count),
      strict_semantic_ok: sum(items, "strictSemanticOk"),
      strict_semantic_ok_rate: rate(sum(items, "strictSemanticOk"), count),
      safe_or_conservative_ok: sum(items, "safeOrConservativeOk"),
      safe_or_conservative_ok_rate: rate(sum(items, "safeOrConservativeOk"), count),
      plane_correct: sum(items, "planeCorrect"),
      role_correct: sum(items, "roleCorrect"),
      effect_kinds_correct: sum(items, "effectKindsCorrect"),
      endpoint_correct: sum(items, "endpointCorrect"),
      identity_correct: sum(items, "identityCorrect"),
      forbidden_clean: sum(items, "forbiddenClean"),
      avg_elapsed_ms: Math.round(items.reduce((acc, item) => acc + Number(item.elapsedMs || 0), 0) / count),
    };
  });
}

function renderSummary({ profile, requestPath, outputRoot, selectedRequests, evaluated, metrics }) {
  return [
    "# Chapter 3.3.1 Evidence Ablation LLM Run",
    "",
    `Profile: ${profile}`,
    `Request queue: ${rel(requestPath)}`,
    `Output root: ${rel(outputRoot)}`,
    `Selected requests: ${selectedRequests.length}`,
    "",
    "## Overall",
    "",
    `- Parse OK: ${sum(evaluated, "parseOk")}/${evaluated.length}`,
    `- Strict semantic OK: ${sum(evaluated, "strictSemanticOk")}/${evaluated.length}`,
    `- Safe or conservative OK: ${sum(evaluated, "safeOrConservativeOk")}/${evaluated.length}`,
    "",
    "## By Variant",
    "",
    "| Variant | Requests | Parse OK | Strict OK | Safe/Conservative OK |",
    "|---|---:|---:|---:|---:|",
    ...metrics.map(row => `| ${row.variant_id} | ${row.request_count} | ${row.parse_ok_rate} | ${row.strict_semantic_ok_rate} | ${row.safe_or_conservative_ok_rate} |`),
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--execute") {
      out.execute = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        index++;
      }
    }
  }
  return out;
}

function loadRequests(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`llm request file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${String(error && error.message || error)}`);
      }
    });
}

function selectRequests(requests, { limit, offset, variantFilter, sampleFilter }) {
  let out = requests;
  if (variantFilter) out = out.filter(request => variantFilter.has(request.variantId));
  if (sampleFilter) out = out.filter(request => sampleFilter.has(request.sampleId));
  if (offset) out = out.slice(offset);
  if (limit !== undefined) out = out.slice(0, limit);
  return out;
}

function validateRequests(requests) {
  const errors = [];
  const seen = new Set();
  for (const request of requests) {
    const id = request.requestId || `${request.sampleId || "unknown"}:${request.variantId || "unknown"}`;
    if (!request.requestId) errors.push(`${id} missing requestId`);
    if (seen.has(request.requestId)) errors.push(`duplicate requestId ${request.requestId}`);
    seen.add(request.requestId);
    if (!request.sampleId) errors.push(`${id} missing sampleId`);
    if (!request.variantId) errors.push(`${id} missing variantId`);
    if (typeof request.system !== "string" || request.system.length === 0) errors.push(`${id} missing system prompt`);
    if (typeof request.user !== "string" || request.user.length === 0) errors.push(`${id} missing user prompt`);
    for (const field of ["oraclePath", "slicePath", "promptPath"]) {
      if (!request[field]) {
        errors.push(`${id} missing ${field}`);
        continue;
      }
      const target = resolveRepoPath(request[field]);
      if (!target.startsWith(repoRoot)) {
        errors.push(`${id} ${field} escapes repo root`);
      }
      if (!fs.existsSync(target)) {
        errors.push(`${id} ${field} does not exist: ${request[field]}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function containsBindingRole(asset, expectedRole) {
  return (asset.bindings || []).some(binding => String(binding && binding.role || "") === expectedRole);
}

function collectEffectKinds(asset) {
  return new Set((asset.effectTemplates || []).map(template => String(template && template.kind || "")).filter(Boolean));
}

function containsCanonicalApiId(asset, canonicalApiId) {
  const surfaces = asset.surfaces || [];
  const bindings = asset.bindings || [];
  return surfaces.some(surface => surface && surface.canonicalApiId === canonicalApiId)
    || bindings.some(binding => binding && binding.canonicalApiId === canonicalApiId);
}

function containsDeepEndpoint(value, expectedEndpoint) {
  const expected = stableJson(expectedEndpoint);
  let found = false;
  const visit = item => {
    if (found || item === null || item === undefined) return;
    if (typeof item === "object") {
      if (stableJson(item) === expected) {
        found = true;
        return;
      }
      if (Array.isArray(item)) {
        for (const child of item) visit(child);
        return;
      }
      for (const child of Object.values(item)) visit(child);
    }
  };
  visit(value);
  return found;
}

function collectForbiddenHits(value, forbidden) {
  const hits = new Set();
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  for (const item of forbidden) {
    const needle = String(item || "").trim();
    if (!needle) continue;
    if (needle.includes(" ")) {
      if (text.includes(needle)) hits.add(needle);
      continue;
    }
    if (containsJsonKey(value, needle) || text.includes(`"${needle}"`)) {
      hits.add(needle);
    }
  }
  return [...hits];
}

function containsJsonKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsJsonKey(item, key));
  return Object.keys(value).some(current => current === key || containsJsonKey(value[current], key));
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function resolveRepoPath(value) {
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(repoRoot, String(value));
}

function normalizeOptionalInt(value) {
  if (value === undefined || value === null || value === true) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (row[field] ? 1 : 0), 0);
}

function rate(numerator, denominator) {
  if (!denominator) return "0.0000";
  return (numerator / denominator).toFixed(4);
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    writeText(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(header => csvCell(row[header])).join(","));
  }
  writeText(filePath, `${lines.join("\n")}\n`);
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function rel(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "Z");
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
