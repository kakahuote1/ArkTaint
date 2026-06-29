#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const DEFAULT_MANIFEST = "tests/manifests/official_semantics_precision_gate.json";
const MODELING_MANIFEST = "tests/manifests/benchmarks/harmony_modeling_benchmark.json";
const MODELING_EXPECTATIONS = "tests/manifests/benchmarks/harmony_modeling_expectations.json";
const HARMONY_BENCH_MANIFEST = "tests/benchmark/HarmonyBench/manifest.json";
const GENERATOR_DRY_RUN_OUT = "tmp/official_semantics_precision_gate/generated";
const GENERATED_SUMMARY = "internal_docs/security_asset_iteration/official_api_semantic_asset_generation_summary.json";

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function valueOf(name, defaultValue) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return defaultValue;
  return args[index + 1];
}

const manifestPath = valueOf("--manifest", DEFAULT_MANIFEST);
const runBehavioral = hasFlag("--run");
const requireReports = hasFlag("--require-reports") || runBehavioral;

function abs(file) {
  return path.resolve(ROOT, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8").replace(/^\uFEFF/, ""));
}

function exists(file) {
  return fs.existsSync(abs(file));
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function npmScriptCommand(scriptName) {
  return process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", scriptName] }
    : { command: "npm", args: ["run", scriptName] };
}

function readPackageScripts() {
  return readJson("package.json").scripts || {};
}

function scriptExists(scripts, scriptName) {
  return Object.prototype.hasOwnProperty.call(scripts, scriptName);
}

function runScript(scriptName) {
  const { command, args } = npmScriptCommand(scriptName);
  const startedAt = Date.now();
  console.log(`[official-semantics-precision] run npm run ${scriptName}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.error) {
    fail(`script launch failed: ${scriptName} error=${result.error.message} elapsed=${elapsed}s`);
  }
  if (result.status !== 0) {
    fail(`script failed: ${scriptName} status=${result.status} elapsed=${elapsed}s`);
  }
  console.log(`[official-semantics-precision] pass ${scriptName} elapsed=${elapsed}s`);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitTopLevel(value, separator) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of String(value || "")) {
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function isVoidTypeText(value) {
  return normalizeText(value).toLowerCase() === "void";
}

function callbackResultArgIndexForType(typeText) {
  const text = normalizeText(typeText);
  const optionalMatch = /^Optional\s*<([\s\S]+)>$/.exec(text);
  if (optionalMatch) return callbackResultArgIndexForType(optionalMatch[1]);
  const asyncMatch = /^AsyncCallback\s*<([\s\S]+)>$/.exec(text);
  if (asyncMatch) return isVoidTypeText(asyncMatch[1]) ? undefined : 1;
  const callbackMatch = /^Callback\s*<([\s\S]+)>$/.exec(text);
  if (callbackMatch) return isVoidTypeText(callbackMatch[1]) ? undefined : 0;
  const functionMatch = /^(?:\(([\s\S]*)\)|([^=()]+))\s*=>\s*([\s\S]+)$/.exec(text);
  if (!functionMatch || !isVoidTypeText(functionMatch[3])) return undefined;
  const paramsText = normalizeText(functionMatch[1] || functionMatch[2] || "");
  if (!paramsText || paramsText === "void") return undefined;
  const params = splitTopLevel(paramsText, ",")
    .map((entry, index) => {
      const colon = entry.indexOf(":");
      const name = colon >= 0 ? entry.slice(0, colon).replace(/[?]/g, "").trim() : "";
      const type = colon >= 0 ? entry.slice(colon + 1).trim() : entry.trim();
      return { index, name, type };
    })
    .filter(param => !isVoidTypeText(param.type));
  if (params.length === 1) return params[0].index;
  const nonError = params.filter(param => !/^(err|error|exception|businessError)$/i.test(param.name));
  return nonError.length === 1 ? nonError[0].index : undefined;
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCanonicalSignature(canonicalApiId) {
  const match = /:params=([^:]+):ret=([^:]+)/.exec(String(canonicalApiId || ""));
  if (!match) return undefined;
  const paramsText = decodePart(match[1]);
  const returnType = decodePart(match[2]);
  const parameters = paramsText === "none"
    ? []
    : splitTopLevel(paramsText, ",").map((entry) => {
        const firstColon = entry.indexOf(":");
        const index = Number(entry.slice(0, firstColon));
        let type = entry.slice(firstColon + 1);
        type = type.replace(/^\?rest:/, "").replace(/^\?:/, "").replace(/^rest:/, "");
        return { index, type };
      });
  return { returnType, parameters };
}

function endpointBases(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (value.base && typeof value.base === "object" && typeof value.base.kind === "string") out.push(value.base);
  if (Array.isArray(value)) {
    for (const item of value) endpointBases(item, out);
    return out;
  }
  for (const child of Object.values(value)) endpointBases(child, out);
  return out;
}

function endpointScanTargetsForBinding(binding, templateById) {
  const targets = [];
  if (binding.endpoint) targets.push({ label: "binding.endpoint", value: binding.endpoint });
  for (const ref of binding.effectTemplateRefs || []) {
    const template = templateById.get(ref);
    if (!template) continue;
    targets.push({ label: `template:${ref}`, value: template });
  }
  return targets;
}

function validateEndpointBase(signature, base, context, failures) {
  if (base.kind === "return" && isVoidTypeText(signature.returnType)) {
    failures.push(`${context}: return endpoint is not projectable for ret=void`);
  }
  if (base.kind === "promiseResult") {
    const match = /^Promise\s*<([\s\S]+)>$/.exec(normalizeText(signature.returnType));
    if (!match || isVoidTypeText(match[1])) {
      failures.push(`${context}: promiseResult endpoint is not projectable for ret=${signature.returnType}`);
    }
  }
  if (base.kind === "arg") {
    if (!Number.isInteger(base.index) || base.index < 0 || base.index >= signature.parameters.length) {
      failures.push(`${context}: arg endpoint index ${base.index} is outside canonical parameter range ${signature.parameters.length}`);
    }
  }
  if (base.kind === "callbackArg" && base.callback?.kind === "arg") {
    const callbackIndex = base.callback.index;
    const param = signature.parameters[callbackIndex];
    if (!param) {
      failures.push(`${context}: callbackArg callback index ${callbackIndex} is outside canonical parameter range ${signature.parameters.length}`);
      return;
    }
    const expected = callbackResultArgIndexForType(param.type);
    if (expected === undefined) {
      failures.push(`${context}: callbackArg is not projectable for callback parameter type ${param.type}`);
      return;
    }
    if (base.argIndex !== expected) {
      failures.push(`${context}: callbackArg argIndex ${base.argIndex} does not match declaration result arg ${expected}`);
    }
  }
}

function parseGeneratedModuleTs(file) {
  const text = fs.readFileSync(abs(file), "utf8");
  const chunks = [];
  const chunkPattern = /^\s*"((?:\\.|[^"\\])*)",?\s*$/gm;
  let match;
  while ((match = chunkPattern.exec(text)) !== null) chunks.push(JSON.parse(`"${match[1]}"`));
  return JSON.parse(chunks.join(""));
}

function readGeneratedAssetDocuments(outputRoot) {
  const files = [
    "src/models/kernel/rules/sources/official_declarations.rules.json",
    "src/models/kernel/rules/sinks/official_declarations.rules.json",
    "src/models/kernel/rules/transfers/official_declarations.rules.json",
    "src/models/kernel/rules/sanitizers/official_declarations.rules.json",
    "src/models/kernel/arkmain/harmony/official_declarations.catalog.json",
  ];
  const docs = [];
  for (const file of files) {
    const generatedFile = path.join(outputRoot, file).replace(/\\/g, "/");
    if (exists(generatedFile)) docs.push({ file: generatedFile, docs: [readJson(generatedFile)] });
  }
  const moduleFile = path.join(outputRoot, "src/models/kernel/modules/harmony/official_declaration_semantic_slots.ts").replace(/\\/g, "/");
  if (exists(moduleFile)) docs.push({ file: moduleFile, docs: parseGeneratedModuleTs(moduleFile) });
  return docs;
}

function validateGeneratedEndpointProjectability(outputRoot) {
  const failures = [];
  let bindingCount = 0;
  for (const artifact of readGeneratedAssetDocuments(outputRoot)) {
    for (const doc of artifact.docs || []) {
      const surfaces = new Map((doc.surfaces || []).map(surface => [surface.surfaceId, surface]));
      const templates = new Map((doc.effectTemplates || []).map(template => [template.id, template]));
      for (const binding of doc.bindings || []) {
        bindingCount++;
        const surface = surfaces.get(binding.surfaceId) || {};
        const canonicalApiId = binding.canonicalApiId || surface.canonicalApiId;
        const signature = parseCanonicalSignature(canonicalApiId);
        if (!signature) {
          failures.push(`${artifact.file}:${binding.bindingId}: canonicalApiId lacks exact params/ret`);
          continue;
        }
        for (const target of endpointScanTargetsForBinding(binding, templates)) {
          for (const base of endpointBases(target.value)) {
            validateEndpointBase(signature, base, `${artifact.file}:${binding.bindingId}:${target.label}:${base.kind}`, failures);
          }
        }
      }
    }
  }
  return { bindingCount, failures };
}

function validateGeneratorDryRun() {
  fs.rmSync(abs(GENERATOR_DRY_RUN_OUT), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ["tools/generate_official_api_semantic_assets.js"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ARKTAINT_OFFICIAL_ASSET_OUTPUT_ROOT: GENERATOR_DRY_RUN_OUT,
    },
  });
  if (result.error) fail(`generator dry-run launch failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`generator dry-run failed: status=${result.status} stderr=${normalizeText(result.stderr)}`);
  }
  const summaryPath = path.join(GENERATOR_DRY_RUN_OUT, GENERATED_SUMMARY).replace(/\\/g, "/");
  assert(exists(summaryPath), `generator dry-run summary missing: ${summaryPath}`);
  const summary = readJson(summaryPath);
  const scan = validateGeneratedEndpointProjectability(GENERATOR_DRY_RUN_OUT);
  assert(scan.failures.length === 0, `generator produced non-projectable endpoints: ${scan.failures.slice(0, 20).join("; ")}`);
  return {
    outputRoot: GENERATOR_DRY_RUN_OUT,
    bindingCount: scan.bindingCount,
    manualReviewCount: Number(summary.manualReviewCount || summary.stats?.manualReview || 0),
  };
}

function countSuiteExpectations(expectations, suiteId) {
  const prefix = `${suiteId}/`;
  const values = Object.entries(expectations.cases || {})
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => Boolean(value));
  return {
    total: values.length,
    positive: values.filter(Boolean).length,
    negative: values.filter(value => !value).length,
  };
}

function validateDeclarationCoverage(contract) {
  assert(contract && contract.ledger, "declarationCoverage.ledger is required");
  assert(exists(contract.ledger), `declaration coverage ledger missing: ${contract.ledger}`);
  const ledger = readJson(contract.ledger);
  const summary = ledger.summary || {};
  if (contract.requiredStrictComplete) {
    assert(summary.strictCompletePassed === true, "official API declaration ledger is not strict-complete");
  }
  assert(Number(summary.needsManualReview || 0) === 0, "official API declaration ledger still has needsManualReview rows");
  assert(Number(summary.unclassified || 0) === 0, "official API declaration ledger still has unclassified rows");
  assert(Number(summary.broadMatchers || 0) === 0, "official kernel assets still contain broad matchers");
  return {
    semanticLedgerRows: summary.semanticLedgerRows || ledger.rows?.length || 0,
    statuses: summary.statuses || {},
  };
}

function validateStaticScripts(contract, scripts) {
  const required = new Set();
  if (contract.declarationCoverage?.script) required.add(contract.declarationCoverage.script);
  for (const gate of contract.staticAssetGates || []) required.add(gate.script);
  for (const gate of contract.behavioralGates || []) required.add(gate.script);
  const missing = [...required].filter(script => !scriptExists(scripts, script));
  assert(missing.length === 0, `package.json is missing required scripts: ${missing.join(", ")}`);
  return [...required].sort();
}

function validateModelingContract(gate) {
  const modelingManifest = readJson(MODELING_MANIFEST);
  const expectations = readJson(MODELING_EXPECTATIONS);
  const suiteById = new Map((modelingManifest.suites || []).map(suite => [suite.id, suite]));
  const missingSuites = [];
  const weakSuites = [];
  for (const suiteId of gate.requiredSuites || []) {
    const suite = suiteById.get(suiteId);
    if (!suite) {
      missingSuites.push(suiteId);
      continue;
    }
    assert(exists(suite.sourceDir), `modeling suite sourceDir missing: ${suiteId} ${suite.sourceDir}`);
    assert(exists(suite.kernelRulePath), `modeling suite kernelRule missing: ${suiteId} ${suite.kernelRulePath}`);
    assert(exists(suite.projectRulePath), `modeling suite projectRule missing: ${suiteId} ${suite.projectRulePath}`);
    const counts = countSuiteExpectations(expectations, suiteId);
    if (
      counts.positive < Number(gate.minimumPositiveCases || 0)
      || counts.negative < Number(gate.minimumNegativeCases || 0)
    ) {
      weakSuites.push(`${suiteId}(T=${counts.positive},F=${counts.negative})`);
    }
  }
  assert(missingSuites.length === 0, `modeling precision suites missing: ${missingSuites.join(", ")}`);
  assert(weakSuites.length === 0, `modeling precision suites lack positive/negative coverage: ${weakSuites.join(", ")}`);
}

function validateHarmonyBenchContract(gate) {
  const reportManifest = readJson("tests/benchmark/HarmonyBench/gates/c12_c14_gate.manifest.json");
  const categoryById = new Map((reportManifest.categories || []).map(category => [category.id, category]));
  for (const categoryId of gate.requiredCategories || []) {
    const category = categoryById.get(categoryId);
    assert(category, `HarmonyBench precision category missing from c12-c14 gate: ${categoryId}`);
    assert(category.supported === true, `HarmonyBench precision category must be supported=true: ${categoryId}`);
    assert(exists(category.sourceDir), `HarmonyBench category sourceDir missing: ${categoryId} ${category.sourceDir}`);
    assert(exists(category.rules.kernelRule), `HarmonyBench category kernelRule missing: ${categoryId}`);
    assert(exists(category.rules.ruleCatalog), `HarmonyBench category ruleCatalog missing: ${categoryId}`);
    assert(exists(category.rules.project), `HarmonyBench category project rules missing: ${categoryId}`);
    const positive = (category.cases || []).filter(item => item.expected_flow === true).length;
    const negative = (category.cases || []).filter(item => item.expected_flow === false).length;
    assert(positive > 0 && negative > 0, `HarmonyBench precision category needs T/F cases: ${categoryId}`);
  }
}

function validateLegacyDisposition(contract) {
  const harmonyBench = readJson(HARMONY_BENCH_MANIFEST);
  const categories = new Set((harmonyBench.categories || []).map(category => category.id));
  const dispositions = new Map((contract.legacyHarmonyBenchDisposition || []).map(item => [item.legacyCategory, item]));
  const missing = [...categories].filter(id => !dispositions.has(id));
  assert(missing.length === 0, `legacy HarmonyBench categories lack disposition: ${missing.join(", ")}`);
  for (const item of contract.legacyHarmonyBenchDisposition || []) {
    assert(categories.has(item.legacyCategory), `legacy disposition references unknown category: ${item.legacyCategory}`);
    assert(["covered", "out-of-scope"].includes(item.status), `invalid legacy disposition status for ${item.legacyCategory}: ${item.status}`);
    if (item.status === "covered") {
      assert(Array.isArray(item.coveredBy) && item.coveredBy.length > 0, `covered legacy category lacks coveredBy: ${item.legacyCategory}`);
    }
    if (item.status === "out-of-scope") {
      assert(String(item.reason || "").length > 0, `out-of-scope legacy category lacks reason: ${item.legacyCategory}`);
    }
  }
}

function validateModelingReport(gate) {
  if (!exists(gate.report)) {
    assert(!requireReports, `behavior report missing: ${gate.report}`);
    return { report: gate.report, status: "not-run" };
  }
  const report = readJson(gate.report);
  assert(report.benchmarkKind === "harmony_modeling", `unexpected harmony modeling report kind: ${gate.report}`);
  const suiteById = new Map((report.suites || []).map(suite => [suite.suite, suite]));
  const missing = [];
  const failures = [];
  for (const suiteId of gate.requiredSuites || []) {
    const suite = suiteById.get(suiteId);
    if (!suite) {
      missing.push(suiteId);
      continue;
    }
    const failCases = Number(suite.summaries?.modeling?.failCases || 0);
    if (failCases !== Number(gate.requiredModelingFailures || 0)) {
      failures.push(`${suiteId}:failCases=${failCases}`);
    }
  }
  assert(missing.length === 0, `harmony modeling report missing suites: ${missing.join(", ")}`);
  assert(failures.length === 0, `harmony modeling precision failures: ${failures.join(", ")}`);
  return {
    report: gate.report,
    status: "pass",
    totalCases: report.totalCases,
    suiteCount: report.suiteCount,
  };
}

function validateHarmonyBenchReport(gate) {
  if (!exists(gate.report)) {
    assert(!requireReports, `behavior report missing: ${gate.report}`);
    return { report: gate.report, status: "not-run" };
  }
  const report = readJson(gate.report);
  const categoryById = new Map((report.categories || []).map(category => [category.id, category]));
  const missing = [];
  const failures = [];
  for (const categoryId of gate.requiredCategories || []) {
    const category = categoryById.get(categoryId);
    if (!category) {
      missing.push(categoryId);
      continue;
    }
    if (Number(category.fp || 0) !== Number(gate.requiredSupportedFalsePositives || 0)) {
      failures.push(`${categoryId}:fp=${category.fp}`);
    }
    if (Number(category.fn || 0) !== Number(gate.requiredSupportedFalseNegatives || 0)) {
      failures.push(`${categoryId}:fn=${category.fn}`);
    }
  }
  assert(missing.length === 0, `HarmonyBench report missing categories: ${missing.join(", ")}`);
  assert((report.failures || []).length === Number(gate.requiredSupportedFailures || 0), `HarmonyBench supported failures=${(report.failures || []).length}`);
  assert(failures.length === 0, `HarmonyBench precision failures: ${failures.join(", ")}`);
  return {
    report: gate.report,
    status: "pass",
    categoryCount: report.categoryCount,
    caseCount: report.caseCount,
  };
}

function validateBehaviorReport(gate) {
  if (gate.kind === "harmony-modeling-report") return validateModelingReport(gate);
  if (gate.kind === "harmony-bench-report") return validateHarmonyBenchReport(gate);
  fail(`unknown behavioral gate kind: ${gate.kind}`);
}

function main() {
  assert(exists(manifestPath), `precision manifest missing: ${manifestPath}`);
  const contract = readJson(manifestPath);
  const scripts = readPackageScripts();
  const requiredScripts = validateStaticScripts(contract, scripts);
  const declaration = validateDeclarationCoverage(contract.declarationCoverage || {});
  const generatorDryRun = validateGeneratorDryRun();
  validateLegacyDisposition(contract);

  for (const gate of contract.behavioralGates || []) {
    if (gate.kind === "harmony-modeling-report") validateModelingContract(gate);
    if (gate.kind === "harmony-bench-report") validateHarmonyBenchContract(gate);
  }

  if (runBehavioral) {
    const commands = [...new Set((contract.behavioralGates || []).map(gate => gate.script))];
    for (const command of commands) runScript(command);
  }

  const behaviorReports = (contract.behavioralGates || []).map(validateBehaviorReport);
  const notRun = behaviorReports.filter(item => item.status === "not-run").map(item => item.report);

  console.log(`official_semantics_precision declaration_rows=${declaration.semanticLedgerRows}`);
  console.log(`required_scripts=${requiredScripts.length}`);
  console.log(`generator_dry_run=${generatorDryRun.outputRoot} bindings=${generatorDryRun.bindingCount} manualReview=${generatorDryRun.manualReviewCount}`);
  console.log(`behavior_reports=${behaviorReports.map(item => `${item.status}:${item.report}`).join(",")}`);
  if (notRun.length > 0) {
    console.log(`behavior_reports_not_run=${notRun.join(",")}`);
  }
  console.log("official_semantics_precision=PASS");
}

try {
  main();
} catch (error) {
  console.error(`OFFICIAL_SEMANTICS_PRECISION_GATE_FAILED ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
