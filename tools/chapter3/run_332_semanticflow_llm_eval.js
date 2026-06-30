const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const defaultDatasetRoot = path.join(
  repoRoot,
  "internal_docs/reports/chapter3_experiment_artifacts/final/datasets/semanticflow_332",
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
  const requestPath = path.resolve(args.requests || path.join(datasetRoot, "llm_requests.jsonl"));
  const profile = args.llmProfile || "deepseek-v4-pro";
  const execute = args.execute === true;
  const outputRoot = path.resolve(args.outputDir || path.join(
    repoRoot,
    "internal_docs/reports/chapter3_experiment_artifacts/final/runs/33_llm_asset_generation/model_stability/semanticflow_332",
    `${profile}_${timestamp()}`,
  ));

  if (!allowedProfiles.has(profile)) {
    throw new Error(`unsupported --llmProfile ${profile}; allowed=${[...allowedProfiles].join(",")}`);
  }

  const requests = loadRequests(requestPath);
  const validation = validateRequests(datasetRoot, requests);
  const dryRunSummary = {
    mode: execute ? "execute" : "dry-run",
    datasetRoot,
    requestPath,
    outputRoot,
    llmProfile: profile,
    requestCount: requests.length,
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
    timeoutMs: Number(args.timeoutMs || 90000),
    connectTimeoutMs: Number(args.connectTimeoutMs || 15000),
    maxAttempts: Number(args.transportMaxAttempts || args.maxTransportAttempts || 1),
  });
  if (!invoker) {
    throw new Error(`LLM profile is not available: ${profile}`);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const rawPath = path.join(outputRoot, "raw_records.jsonl");
  const manifestPath = path.join(outputRoot, "run_manifest.json");
  writeJson(manifestPath, {
    ...dryRunSummary,
    startedAt: new Date().toISOString(),
    rawRecords: rawPath,
    requestTimeoutMs: Number(args.timeoutMs || 90000),
    requestMaxAttempts: Number(args.requestMaxAttempts || args.maxAttempts || 1),
  });

  for (const request of requests) {
    const startedAt = Date.now();
    const requestAttempts = Number(args.requestMaxAttempts || args.maxAttempts || 1);
    const result = await invokeWithRequestRetries({
      invoker,
      request,
      profile,
      parseSemanticFlowAssetDecision,
      maxAttempts: requestAttempts,
    });
    fs.appendFileSync(rawPath, `${JSON.stringify({
      sampleId: request.sampleId,
      profile,
      elapsedMs: Date.now() - startedAt,
      ok: !result.error,
      status: result.parsed && result.parsed.status,
      parsed: result.parsed,
      raw: result.raw,
      error: result.error,
      attemptCount: result.attemptCount,
      attempts: result.attempts,
      skipped: Boolean(result.error && result.attemptCount >= requestAttempts),
      oraclePath: request.oraclePath,
      slicePath: request.slicePath,
    })}\n`, "utf8");
  }
}

async function invokeWithRequestRetries({ invoker, request, profile, parseSemanticFlowAssetDecision, maxAttempts }) {
  const attempts = [];
  let lastRaw = "";
  let lastParsed;
  let lastError = "";
  const count = Math.max(1, Number(maxAttempts || 1));
  for (let attempt = 1; attempt <= count; attempt++) {
    const startedAt = Date.now();
    let raw = "";
    let parsed;
    let error = "";
    try {
      raw = await invoker({
        system: request.system,
        user: request.user,
      });
      try {
        parsed = parseSemanticFlowAssetDecision(raw);
      } catch (parseError) {
        error = String(parseError && parseError.message || parseError);
      }
    } catch (invokeError) {
      error = String(invokeError && invokeError.message || invokeError);
    }
    attempts.push({
      attempt,
      elapsedMs: Date.now() - startedAt,
      ok: !error,
      status: parsed && parsed.status,
      error,
    });
    lastRaw = raw;
    lastParsed = parsed;
    lastError = error;
    if (!error) {
      return { raw, parsed, error: "", attemptCount: attempt, attempts };
    }
    console.log(`332_eval retry profile=${profile} sample=${request.sampleId} attempt=${attempt}/${count} error=${error.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  return { raw: lastRaw, parsed: lastParsed, error: lastError, attemptCount: count, attempts };
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

function validateRequests(datasetRoot, requests) {
  const errors = [];
  const seen = new Set();
  for (const request of requests) {
    if (!request.sampleId) errors.push("request missing sampleId");
    if (seen.has(request.sampleId)) errors.push(`duplicate request sampleId ${request.sampleId}`);
    seen.add(request.sampleId);
    if (typeof request.system !== "string" || request.system.length === 0) errors.push(`${request.sampleId} missing system prompt`);
    if (typeof request.user !== "string" || request.user.length === 0) errors.push(`${request.sampleId} missing user prompt`);
    for (const field of ["oraclePath", "slicePath", "promptPath"]) {
      if (!request[field]) {
        errors.push(`${request.sampleId} missing ${field}`);
        continue;
      }
      const target = path.resolve(datasetRoot, request[field]);
      if (!target.startsWith(path.resolve(datasetRoot))) {
        errors.push(`${request.sampleId} ${field} escapes dataset root`);
      }
      if (!fs.existsSync(target)) {
        errors.push(`${request.sampleId} ${field} does not exist: ${request[field]}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "Z");
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
