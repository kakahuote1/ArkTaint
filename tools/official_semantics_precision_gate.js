#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const DEFAULT_MANIFEST = "tests/manifests/official_semantics_precision_gate.json";
const MODELING_MANIFEST = "tests/manifests/benchmarks/harmony_modeling_benchmark.json";
const MODELING_EXPECTATIONS = "tests/manifests/benchmarks/harmony_modeling_expectations.json";
const HARMONY_BENCH_MANIFEST = "tests/benchmark/HarmonyBench/manifest.json";

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
