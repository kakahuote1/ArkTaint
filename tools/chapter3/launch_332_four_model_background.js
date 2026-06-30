const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const repoRoot = path.resolve(__dirname, "../..");
const groupId = `four_models_332_${timestampForPath()}`;
const baseOutputDir = path.join(
  repoRoot,
  "internal_docs/reports/chapter3_experiment_artifacts/final/runs/33_llm_asset_generation/model_stability/semanticflow_332",
  groupId,
);

const profiles = [
  { name: "deepseek-v4-pro", timeoutMs: 180000, connectTimeoutMs: 30000, requestMaxAttempts: 2 },
  { name: "qwen3.7-plus", timeoutMs: 180000, connectTimeoutMs: 30000, requestMaxAttempts: 2 },
  { name: "mimo-v2.5-pro", timeoutMs: 180000, connectTimeoutMs: 30000, requestMaxAttempts: 2 },
  { name: "doubao-seed2.1", timeoutMs: 300000, connectTimeoutMs: 30000, requestMaxAttempts: 2 },
];

fs.mkdirSync(baseOutputDir, { recursive: true });

const runs = [];
for (const profile of profiles) {
  const outputDir = path.join(baseOutputDir, profile.name);
  fs.mkdirSync(outputDir, { recursive: true });
  const stdoutPath = path.join(outputDir, "stdout.log");
  const stderrPath = path.join(outputDir, "stderr.log");
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const args = [
    path.join(repoRoot, "tools/chapter3/run_332_semanticflow_llm_eval.js"),
    "--execute",
    "--llmProfile", profile.name,
    "--timeoutMs", String(profile.timeoutMs),
    "--connectTimeoutMs", String(profile.connectTimeoutMs),
    "--requestMaxAttempts", String(profile.requestMaxAttempts),
    "--outputDir", outputDir,
  ];
  const child = childProcess.spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.unref();
  runs.push({
    profile: profile.name,
    pid: child.pid,
    command: `${process.execPath} ${args.map(quoteArg).join(" ")}`,
    cwd: repoRoot,
    outputDir,
    stdout: stdoutPath,
    stderr: stderrPath,
    timeoutMs: profile.timeoutMs,
    connectTimeoutMs: profile.connectTimeoutMs,
    requestMaxAttempts: profile.requestMaxAttempts,
    expectedRequests: 293,
    startedAt: new Date().toISOString(),
  });
}

const record = {
  groupId,
  dataset: "semanticflow_332",
  expectedRequestsPerProfile: 293,
  baseOutputDir,
  startedAt: new Date().toISOString(),
  runs,
};
const recordPath = path.join(baseOutputDir, "background_group_record.json");
fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...record, recordPath }, null, 2));

function timestampForPath() {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function quoteArg(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}
