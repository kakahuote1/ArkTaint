#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_PROJECTS_CSV = path.join(REPO_ROOT, "internal_docs/reports/chapter3_selected_15_projects.csv");
const DEFAULT_RUNS_ROOT = path.join(
  REPO_ROOT,
  "internal_docs/reports/chapter3_experiment_artifacts/final/runs/34_semantic_taint_analysis",
);

const CONFIGS = [
  {
    id: "C0_rule_only",
    label: "official_assets_only",
    useAssets: false,
    executionHandoff: "disabled",
    currentness: "disabled",
    chapterUse: ["3.4.1_control", "3.4.2_control"],
  },
  {
    id: "C1_semantic_assets",
    label: "official_plus_semantic_assets",
    useAssets: true,
    executionHandoff: "disabled",
    currentness: "disabled",
    chapterUse: ["3.4.1_semantic_asset_effect", "3.4.2_pre_ude_oclfs_control"],
  },
  {
    id: "C2_semantic_assets_ude",
    label: "semantic_assets_plus_ude",
    useAssets: true,
    executionHandoff: "enabled",
    currentness: "disabled",
    chapterUse: ["3.4.2_ude_effect"],
  },
  {
    id: "C3_full",
    label: "full_semantic_analysis",
    useAssets: true,
    executionHandoff: "enabled",
    currentness: "enabled",
    chapterUse: ["3.4.2_oclfs_effect", "3.4.3_scale_run"],
  },
];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.candidateSourceMap = loadCandidateSourceManifest(opts.candidateSourceManifest);
  const runId = opts.runId || `fifteen_projects_offline_assets_${timestampForPath()}`;
  const outputRoot = path.resolve(opts.outputRoot || path.join(DEFAULT_RUNS_ROOT, runId));
  ensureDir(outputRoot);

  const projects = readSelectedProjects(opts.projectsCsv)
    .slice(opts.startIndex - 1)
    .slice(0, opts.maxProjects > 0 ? opts.maxProjects : undefined);
  if (projects.length === 0) {
    throw new Error(`no projects selected from ${opts.projectsCsv}`);
  }

  const registryPath = path.join(outputRoot, "run_registry.json");
  const progressPath = path.join(outputRoot, "progress.jsonl");
  const statusPath = path.join(outputRoot, "status.json");
  const recordsPath = path.join(outputRoot, "project_config_records.jsonl");
  const assetRecordsPath = path.join(outputRoot, "offline_asset_generation_records.jsonl");
  const selectedCsvCopy = path.join(outputRoot, "selected_15_projects.csv");
  fs.copyFileSync(opts.projectsCsv, selectedCsvCopy);

  const registry = {
    runId,
    startedAt: new Date().toISOString(),
    cwd: REPO_ROOT,
    projectsCsv: opts.projectsCsv,
    selectedCsvCopy,
    outputRoot,
    configIds: CONFIGS.map(item => item.id),
    options: publicOptions(opts),
    statusPath,
    progressPath,
    recordsPath,
    assetRecordsPath,
  };
  writeJson(registryPath, registry);

  logProgress(progressPath, {
    type: "run_start",
    runId,
    outputRoot,
    projectCount: projects.length,
    configs: CONFIGS.map(item => item.id),
  });

  const allRecords = [];
  const assetRecords = [];
  for (let projectIndex = 0; projectIndex < projects.length; projectIndex++) {
    const project = projects[projectIndex];
    const projectRunDir = path.join(outputRoot, "projects", `${pad(projectIndex + 1)}_${safeFileName(project.project)}`);
    ensureDir(projectRunDir);
    writeJson(path.join(projectRunDir, "project_manifest.json"), project);
    updateStatus(statusPath, {
      runId,
      phase: "project_start",
      projectIndex: projectIndex + 1,
      projectCount: projects.length,
      project: project.project,
      startedAt: registry.startedAt,
      updatedAt: new Date().toISOString(),
    });
    logProgress(progressPath, {
      type: "project_start",
      projectIndex: projectIndex + 1,
      projectCount: projects.length,
      project: project.project,
      localPath: project.localPath,
    });

    let assetRecord = undefined;
    for (const config of CONFIGS) {
      if (config.useAssets && !assetRecord) {
        assetRecord = generateOfflineAssetsFromBaseline(project, projectRunDir, opts);
        assetRecords.push(assetRecord);
        appendJsonl(assetRecordsPath, assetRecord);
      }
      const configRunDir = path.join(projectRunDir, "configs", config.id);
      const record = await runConfig({
        opts,
        runId,
        project,
        projectIndex,
        projectCount: projects.length,
        config,
        configRunDir,
        assetRecord,
        progressPath,
        statusPath,
      });
      allRecords.push(record);
      appendJsonl(recordsPath, record);

      if (!assetRecord && config.id === "C0_rule_only") {
        assetRecord = generateOfflineAssetsFromBaseline(project, projectRunDir, opts);
        assetRecords.push(assetRecord);
        appendJsonl(assetRecordsPath, assetRecord);
      }
      writeSummaries(outputRoot, allRecords, assetRecords);
    }
    logProgress(progressPath, {
      type: "project_done",
      projectIndex: projectIndex + 1,
      projectCount: projects.length,
      project: project.project,
    });
  }

  writeSummaries(outputRoot, allRecords, assetRecords);
  updateStatus(statusPath, {
    runId,
    phase: "done",
    projectCount: projects.length,
    configCount: CONFIGS.length,
    completedRecords: allRecords.length,
    outputRoot,
    updatedAt: new Date().toISOString(),
  });
  logProgress(progressPath, {
    type: "run_done",
    runId,
    recordCount: allRecords.length,
    outputRoot,
  });
  console.log(`[34-run] done runId=${runId} outputRoot=${outputRoot}`);
}

function parseArgs(argv) {
  const opts = {
    projectsCsv: DEFAULT_PROJECTS_CSV,
    outputRoot: "",
    runId: "",
    maxProjects: 0,
    startIndex: 1,
    projectTimeoutSeconds: 900,
    sourceDirTimeoutSeconds: 300,
    heartbeatSeconds: 20,
    worklistBudgetMs: 180000,
    worklistMaxVisited: 0,
    maxEntries: 9999,
    maxAssetCandidates: 120,
    candidateSourceManifest: "",
    splitSourceDirThreshold: 24,
    maxSplitSourceDirs: 0,
    flowMode: "postsolve",
    reportMode: "full",
    entryModel: "arkMain",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--projectsCsv":
      case "--projects-csv":
        opts.projectsCsv = path.resolve(next());
        break;
      case "--outputRoot":
      case "--output-root":
        opts.outputRoot = path.resolve(next());
        break;
      case "--runId":
      case "--run-id":
        opts.runId = next();
        break;
      case "--maxProjects":
        opts.maxProjects = parseIntStrict(next(), arg);
        break;
      case "--startIndex":
        opts.startIndex = parseIntStrict(next(), arg);
        break;
      case "--projectTimeoutSeconds":
        opts.projectTimeoutSeconds = parseIntStrict(next(), arg);
        break;
      case "--sourceDirTimeoutSeconds":
        opts.sourceDirTimeoutSeconds = parseIntStrict(next(), arg);
        break;
      case "--heartbeatSeconds":
        opts.heartbeatSeconds = parseIntStrict(next(), arg);
        break;
      case "--worklistBudgetMs":
        opts.worklistBudgetMs = parseIntStrict(next(), arg);
        break;
      case "--worklistMaxVisited":
        opts.worklistMaxVisited = parseIntStrict(next(), arg);
        break;
      case "--maxEntries":
        opts.maxEntries = parseIntStrict(next(), arg);
        break;
      case "--maxAssetCandidates":
        opts.maxAssetCandidates = parseIntStrict(next(), arg);
        break;
      case "--candidateSourceManifest":
      case "--candidate-source-manifest":
        opts.candidateSourceManifest = path.resolve(next());
        break;
      case "--splitSourceDirThreshold":
        opts.splitSourceDirThreshold = parseIntStrict(next(), arg);
        break;
      case "--maxSplitSourceDirs":
        opts.maxSplitSourceDirs = parseIntStrict(next(), arg);
        break;
      case "--flowMode":
        opts.flowMode = next();
        break;
      case "--reportMode":
        opts.reportMode = next();
        break;
      case "--entryModel":
        opts.entryModel = next();
        break;
      case "--dryRun":
        opts.dryRun = true;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }
  opts.projectsCsv = path.resolve(opts.projectsCsv);
  if (opts.candidateSourceManifest) opts.candidateSourceManifest = path.resolve(opts.candidateSourceManifest);
  if (opts.startIndex < 1) throw new Error("--startIndex must be >= 1");
  return opts;
}

function readSelectedProjects(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`selected projects csv not found: ${csvPath}`);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, ""));
  return rows.map(row => ({
    sampleOrder: Number(row.sampleOrder || 0),
    project: String(row.project || "").trim(),
    inventoryName: String(row.inventoryName || "").trim(),
    localPath: path.resolve(String(row.localPath || "").trim()),
    sourceUrls: String(row.sourceUrls || "").trim(),
    sizeTier: String(row.sizeTier || "").trim(),
    productionEtsFiles: Number(row.productionEtsFiles || 0),
    etsFiles: Number(row.etsFiles || 0),
    selectionBucket: String(row.selectionBucket || "").trim(),
    selectionReason: String(row.selectionReason || "").trim(),
  })).filter(row => row.project && row.localPath && fs.existsSync(row.localPath));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some(value => value.length > 0)) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map(value => value.trim());
  return rows.slice(1).map(values => {
    const out = {};
    header.forEach((name, index) => {
      out[name] = values[index] || "";
    });
    return out;
  });
}

async function runConfig(input) {
  const { opts, runId, project, projectIndex, projectCount, config, configRunDir, assetRecord, progressPath, statusPath } = input;
  ensureDir(configRunDir);
  const projectRoot = path.dirname(project.localPath);
  const projectFolder = path.basename(project.localPath);
  const stdoutPath = path.join(configRunDir, "driver_stdout.log");
  const stderrPath = path.join(configRunDir, "driver_stderr.log");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const args = [
    path.join(REPO_ROOT, "out/tools/real_project_batch_analyze.js"),
    "--projectRoot", projectRoot,
    "--projects", projectFolder,
    "--outputDir", configRunDir,
    "--executionHandoff", config.executionHandoff,
    "--currentness", config.currentness,
    "--projectTimeoutSeconds", String(opts.projectTimeoutSeconds),
    "--heartbeatSeconds", String(opts.heartbeatSeconds),
    "--reportMode", opts.reportMode,
    "--entryModel", opts.entryModel,
    "--flowMode", opts.flowMode,
    "--maxEntries", String(opts.maxEntries),
    "--worklistBudgetMs", String(opts.worklistBudgetMs),
    "--worklistMaxVisited", String(opts.worklistMaxVisited),
    "--sourceDirMode", "auto",
    "--splitSourceDirThreshold", String(opts.splitSourceDirThreshold),
    "--sourceDirTimeoutSeconds", String(opts.sourceDirTimeoutSeconds),
    "--maxSplitSourceDirs", String(opts.maxSplitSourceDirs),
    "--projectRetries", "0",
  ];
  if (config.useAssets && assetRecord && assetRecord.assetCount > 0) {
    args.push("--model-root", assetRecord.modelRoot);
    args.push("--semanticflow-evaluation-model-root", assetRecord.modelRoot);
    args.push("--enable-model", assetRecord.packId);
    args.push("--semanticAssetReachabilityScope", "allExactSites");
  }

  const commandText = `${process.execPath} ${args.map(quoteArg).join(" ")}`;
  const manifest = {
    runId,
    project: project.project,
    projectRoot,
    projectFolder,
    config,
    startedAt,
    cwd: REPO_ROOT,
    command: commandText,
    stdoutPath,
    stderrPath,
    assetRecord: config.useAssets ? assetRecord : undefined,
  };
  writeJson(path.join(configRunDir, "config_manifest.json"), manifest);
  logProgress(progressPath, {
    type: "config_start",
    projectIndex: projectIndex + 1,
    projectCount,
    project: project.project,
    configId: config.id,
    configRunDir,
    assetCount: config.useAssets && assetRecord ? assetRecord.assetCount : 0,
  });
  updateStatus(statusPath, {
    runId,
    phase: "config_running",
    projectIndex: projectIndex + 1,
    projectCount,
    project: project.project,
    configId: config.id,
    configRunDir,
    startedAt,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[34-run] start project=${project.project} config=${config.id} assetCount=${config.useAssets && assetRecord ? assetRecord.assetCount : 0}`);
  if (opts.dryRun) {
    return summarizeConfigRecord(project, config, configRunDir, startedAt, Date.now(), {
      status: "dry_run",
      command: commandText,
      exitCode: 0,
      error: "",
    });
  }

  const stdout = fs.createWriteStream(stdoutPath, { flags: "a" });
  const stderr = fs.createWriteStream(stderrPath, { flags: "a" });
  const child = childProcess.spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ARKTAINT_ANALYZE_PROGRESS: "1",
      ARKTAINT_BATCH_PROGRESS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const heartbeat = setInterval(() => {
    const elapsedMs = Date.now() - startedMs;
    const payload = {
      type: "heartbeat",
      projectIndex: projectIndex + 1,
      projectCount,
      project: project.project,
      configId: config.id,
      childPid: child.pid,
      elapsedMs,
      configRunDir,
      updatedAt: new Date().toISOString(),
    };
    logProgress(progressPath, payload);
    updateStatus(statusPath, {
      runId,
      phase: "config_running",
      projectIndex: projectIndex + 1,
      projectCount,
      project: project.project,
      configId: config.id,
      childPid: child.pid,
      elapsedMs,
      configRunDir,
      latestArtifact: latestArtifactForConfig(configRunDir, project.project),
      updatedAt: new Date().toISOString(),
    });
    console.log(`[34-run] heartbeat project=${project.project} config=${config.id} pid=${child.pid} elapsed_s=${Math.round(elapsedMs / 1000)}`);
  }, Math.max(5000, opts.heartbeatSeconds * 1000));

  child.stdout.on("data", chunk => {
    stdout.write(chunk);
    process.stdout.write(prefixLines(chunk.toString("utf-8"), `[${project.project}/${config.id}] `));
  });
  child.stderr.on("data", chunk => {
    stderr.write(chunk);
    process.stderr.write(prefixLines(chunk.toString("utf-8"), `[${project.project}/${config.id}:err] `));
  });

  const result = await new Promise(resolve => {
    child.on("error", error => resolve({ exitCode: null, error: String(error && error.message || error) }));
    child.on("close", code => resolve({ exitCode: code, error: "" }));
  });
  clearInterval(heartbeat);
  stdout.end();
  stderr.end();

  const endedMs = Date.now();
  const record = summarizeConfigRecord(project, config, configRunDir, startedAt, endedMs, {
    exitCode: result.exitCode,
    error: result.error,
    command: commandText,
    status: result.exitCode === 0 ? "completed" : "failed",
    assetCount: config.useAssets && assetRecord ? assetRecord.assetCount : 0,
    packId: config.useAssets && assetRecord ? assetRecord.packId : "",
  });
  writeJson(path.join(configRunDir, "config_summary.json"), record);
  logProgress(progressPath, {
    type: "config_done",
    projectIndex: projectIndex + 1,
    projectCount,
    project: project.project,
    configId: config.id,
    status: record.status,
    exitCode: record.exitCode,
    elapsedMs: record.elapsedMs,
    totalFlows: record.totalFlows,
    observedFlows: record.observedFlows,
  });
  updateStatus(statusPath, {
    runId,
    phase: "config_done",
    projectIndex: projectIndex + 1,
    projectCount,
    project: project.project,
    configId: config.id,
    status: record.status,
    elapsedMs: record.elapsedMs,
    totalFlows: record.totalFlows,
    observedFlows: record.observedFlows,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[34-run] done project=${project.project} config=${config.id} status=${record.status} elapsed_s=${Math.round(record.elapsedMs / 1000)} flows=${record.totalFlows ?? ""} observed=${record.observedFlows ?? ""}`);
  return record;
}

function generateOfflineAssetsFromBaseline(project, projectRunDir, opts) {
  const baselineDir = path.join(projectRunDir, "configs", "C0_rule_only");
  const assetDir = path.join(projectRunDir, "offline_assets");
  const modelRoot = path.join(assetDir, "model_root");
  const decisionsPath = path.join(assetDir, "offline_asset_decisions.jsonl");
  const summaryPath = path.join(assetDir, "offline_asset_summary.json");
  ensureDir(assetDir);
  if (fs.existsSync(summaryPath)) {
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  const candidateResolution = findCandidateJson(baselineDir, project, opts);
  const candidatePath = candidateResolution.path;
  const packId = `semanticflow_${safeModelId(project.project)}`;
  const recordBase = {
    project: project.project,
    packId,
    modelRoot,
    candidatePath,
    candidateSource: candidateResolution.source,
    candidateSourceManifest: candidateResolution.manifestPath,
    decisionsPath,
    summaryPath,
    generatedAt: new Date().toISOString(),
  };
  if (!candidatePath) {
    const record = {
      ...recordBase,
      status: "no_candidates",
      candidateCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      assetCount: 0,
      roleCounts: {},
      published: {},
    };
    writeJson(summaryPath, record);
    return record;
  }

  const candidateDoc = JSON.parse(fs.readFileSync(candidatePath, "utf-8"));
  const items = Array.isArray(candidateDoc.items) ? candidateDoc.items : [];
  const decisions = [];
  const assets = [];
  const roleCounts = {};
  const seenKeys = new Set();
  for (const item of items) {
    const identity = resolveProjectCandidateIdentity(project, item);
    const effectiveItem = identity.ok ? identity.item : item;
    const decision = identity.ok ? classifyCandidate(effectiveItem) : reject(identity.reason);
    const key = `${decision.role || "reject"}:${effectiveItem.canonicalApiId || ""}:${decision.endpointKey || ""}`;
    if (decision.accepted && seenKeys.has(key)) {
      decisions.push({ ...decision, accepted: false, reason: "duplicate_semantic_shape", item: shrinkCandidate(effectiveItem) });
      continue;
    }
    if (decision.accepted && assets.length >= opts.maxAssetCandidates) {
      decisions.push({ ...decision, accepted: false, reason: "max_asset_candidates_reached", item: shrinkCandidate(effectiveItem) });
      continue;
    }
    if (!decision.accepted) {
      decisions.push({ ...decision, item: shrinkCandidate(effectiveItem) });
      continue;
    }
    seenKeys.add(key);
    const made = buildAssetFromDecision(project, effectiveItem, decision, packId);
    assets.push(made.asset);
    roleCounts[decision.role] = (roleCounts[decision.role] || 0) + made.bindingCount;
    decisions.push({ ...decision, item: shrinkCandidate(effectiveItem), assetId: made.asset.id, bindingCount: made.bindingCount });
  }
  fs.writeFileSync(decisionsPath, decisions.map(item => JSON.stringify(item)).join("\n") + (decisions.length ? "\n" : ""), "utf-8");

  const validation = validateAssets(assets);
  let published = {};
  if (assets.length > 0 && validation.ok) {
    const { publishSemanticFlowProjectAssets } = require(path.join(REPO_ROOT, "out/core/semanticflow/SemanticFlowProjectAssets.js"));
    published = publishSemanticFlowProjectAssets({
      projectId: packId,
      modelRoot,
      assets,
    });
  }
  const record = {
    ...recordBase,
    status: validation.ok ? "generated" : "validation_failed",
    candidateCount: items.length,
    acceptedCount: decisions.filter(item => item.accepted).length,
    rejectedCount: decisions.filter(item => !item.accepted).length,
    assetCount: assets.length,
    roleCounts,
    validation,
    published,
  };
  writeJson(summaryPath, record);
  return record;
}

function resolveProjectCandidateIdentity(project, item) {
    const derived = deriveProjectCanonicalApiId(project, item);
    if (!derived.ok) {
        return { ok: false, reason: derived.reason };
    }
    return {
        ok: true,
        item: {
            ...item,
      canonicalApiId: derived.canonicalApiId,
      returnType: derived.returnType || item.returnType,
      derivedCanonicalApiId: true,
      derivedCanonicalApiIdEvidence: derived.evidence,
    },
  };
}

function deriveProjectCanonicalApiId(project, item) {
  const sourceFile = normalizeLogicalSourceFile(item.sourceFile);
  if (!sourceFile) return { ok: false, reason: "missing_project_source_file_for_identity" };
  const method = String(item.method || "").trim();
  if (!method || isUnknownIdentityText(method)) return { ok: false, reason: "missing_project_method_for_identity" };
  const owner = parseOwnerFromCalleeSignature(item.callee_signature, method);
  if (!owner.ok) return { ok: false, reason: owner.reason };
  const signature = parseMethodSignatureFromSnippet(item.methodSnippet, method, Number(item.argCount || 0));
  if (!signature.ok) return { ok: false, reason: signature.reason };
    const memberKind = owner.ownerName ? "method" : "function";
    const member = memberKind === "method"
        ? `method:${owner.staticMember ? "static" : "instance"}:${method}`
        : `function:${method}`;
    const declaration = owner.ownerName
        ? `class:${owner.ownerName}`
        : "namespace:file";
    const exportPath = owner.ownerName
        ? `namespace:${owner.ownerName}`
        : "default:file";
  const { serializeCanonicalApiId, assertValidCanonicalApiId } = require(path.join(REPO_ROOT, "out/core/api/identity/CanonicalApiId.js"));
  const canonicalApiId = serializeCanonicalApiId({
    authority: "project",
    domain: "local",
    module: sourceFile,
    file: sourceFile,
    export: exportPath,
    decl: declaration,
    member,
    invoke: "call",
    params: signature.params,
    ret: signature.returnType,
  });
  try {
    assertValidCanonicalApiId(canonicalApiId);
  } catch (error) {
    return {
      ok: false,
      reason: "derived_project_canonical_id_invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true,
    canonicalApiId,
    returnType: signature.returnType,
    evidence: {
      source: "project_declaration_signature",
      project: project.project,
      sourceFile,
      owner: owner.ownerName || "",
      method,
      params: signature.params,
      returnType: signature.returnType,
    },
  };
}

function normalizeLogicalSourceFile(value) {
  const text = String(value || "").replace(/\\/g, "/").trim();
  if (!text || text.includes("%unk") || text.includes("@unk")) return "";
  if (/^[A-Za-z]:\//.test(text) || text.startsWith("//")) return "";
  return text.replace(/^\/+/, "");
}

function parseOwnerFromCalleeSignature(value, method) {
  const signature = String(value || "").trim();
  if (!signature || signature.includes("%unk") || signature.includes("@unk")) {
    return { ok: false, reason: "callee_signature_unknown_for_identity" };
  }
  const colon = signature.indexOf(":");
  const right = colon >= 0 ? signature.slice(colon + 1).trim() : signature;
  const beforeParams = right.replace(/\([^)]*\)\s*$/, "").trim();
  if (!beforeParams || beforeParams.startsWith(".")) {
    return { ok: false, reason: "missing_project_owner_for_identity" };
  }
  const staticNeedle = `.[static]${method}`;
  const staticIndex = beforeParams.lastIndexOf(staticNeedle);
  if (staticIndex > 0) {
    const ownerName = cleanOwnerName(beforeParams.slice(0, staticIndex));
    return ownerName
      ? { ok: true, ownerName, staticMember: true }
      : { ok: false, reason: "missing_project_owner_for_identity" };
  }
  const dotNeedle = `.${method}`;
  const dotIndex = beforeParams.lastIndexOf(dotNeedle);
  if (dotIndex > 0) {
    const ownerText = beforeParams.slice(0, dotIndex);
    if (isDefaultProjectOwnerText(ownerText)) {
      return { ok: true, ownerName: "", staticMember: false };
    }
    const ownerName = cleanOwnerName(ownerText);
    return ownerName
      ? { ok: true, ownerName, staticMember: false }
      : { ok: false, reason: "missing_project_owner_for_identity" };
  }
  if (beforeParams === method) {
    return { ok: true, ownerName: "", staticMember: false };
  }
  return { ok: false, reason: "callee_signature_owner_unparseable" };
}

function cleanOwnerName(value) {
  const text = String(value || "").trim().split(/\s+/).pop() || "";
  if (!text || isUnknownIdentityText(text)) return "";
  if (isDefaultProjectOwnerText(text)) return "";
  return text.replace(/[^\w.$]/g, "");
}

function isDefaultProjectOwnerText(value) {
  const text = String(value || "").trim();
  return text === "%dflt" || text === "dflt";
}

function parseMethodSignatureFromSnippet(snippet, method, argCount) {
  const code = stripSnippetLinePrefixes(String(snippet || ""));
  if (!code.trim()) return { ok: false, reason: "missing_method_snippet_for_identity" };
  const match = findMethodSignatureMatch(code, method);
  if (!match) return { ok: false, reason: "method_signature_unparseable" };
  const prefix = match.prefix || "";
  const paramsText = match.params || "";
  const explicitReturn = String(match.returnType || "").trim();
  const params = parseCanonicalParams(paramsText, argCount);
  if (!params.ok) return params;
  const returnType = normalizeReturnType(explicitReturn || inferImplicitReturnType(prefix));
  if (!returnType || isUnknownIdentityText(returnType) || returnType.toLowerCase() === "unknown") {
    return { ok: false, reason: "return_type_unknown_for_identity" };
  }
  return { ok: true, params: params.value, returnType };
}

function stripSnippetLinePrefixes(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\d+\s*\|\s?/, ""))
    .join("\n");
}

function findMethodSignatureMatch(code, method) {
  const escaped = escapeRegExp(method);
  const regex = new RegExp(`(?<prefix>(?:public|private|protected|static|async|readonly|override|export|default|declare|abstract|\\s)+)?\\b${escaped}\\s*(?:<[^>]*>)?\\s*\\((?<params>[^)]*)\\)\\s*(?::\\s*(?<returnType>[^\\{;=\\n]+))?`, "m");
  return regex.exec(code)?.groups;
}

function parseCanonicalParams(paramsText, argCount) {
  const rawParams = splitTopLevel(paramsText, ",").map(item => item.trim()).filter(Boolean);
  if (rawParams.length === 0) {
    return Number(argCount || 0) === 0
      ? { ok: true, value: "none" }
      : { ok: false, reason: "parameter_type_missing_for_identity" };
  }
  const entries = [];
  for (let index = 0; index < rawParams.length; index++) {
    const parsed = parseParam(rawParams[index]);
    if (!parsed.ok) return parsed;
    entries.push(`${index}:${parsed.optional ? "?:" : ""}${parsed.rest ? "rest:" : ""}${parsed.type}`);
  }
  if (Number.isInteger(argCount) && argCount >= 0 && rawParams.length !== argCount) {
    return { ok: false, reason: "parameter_count_mismatch_for_identity" };
  }
  return { ok: true, value: entries.join(",") };
}

function parseParam(value) {
  let text = String(value || "").trim();
  if (!text) return { ok: false, reason: "parameter_type_missing_for_identity" };
  text = text.replace(/^(public|private|protected|readonly)\s+/, "").trim();
  const rest = text.startsWith("...");
  if (rest) text = text.slice(3).trim();
  const colonIndex = findTopLevelColon(text);
  if (colonIndex < 0) return { ok: false, reason: "parameter_type_missing_for_identity" };
  const name = text.slice(0, colonIndex).trim();
  const optional = name.endsWith("?");
  const type = normalizeTypeText(text.slice(colonIndex + 1));
  if (!type || isUnknownIdentityText(type) || type.toLowerCase() === "unknown") {
    return { ok: false, reason: "parameter_type_unknown_for_identity" };
  }
  return { ok: true, optional, rest, type };
}

function findTopLevelColon(value) {
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (ch === "<") depthAngle++;
    else if (ch === ">") depthAngle = Math.max(0, depthAngle - 1);
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === ":" && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      return index;
    }
  }
  return -1;
}

function normalizeTypeText(value) {
  return String(value || "")
    .replace(/=.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReturnType(value) {
  return normalizeTypeText(value).replace(/\s+$/, "");
}

function inferImplicitReturnType(prefix) {
  return /\basync\b/.test(String(prefix || "")) ? "Promise<void>" : "void";
}

function splitTopLevel(value, delimiter) {
  const result = [];
  let current = "";
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (ch === "<") depthAngle++;
    else if (ch === ">") depthAngle = Math.max(0, depthAngle - 1);
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    if (ch === delimiter && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isUnknownIdentityText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  if (text === "unknown" || text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
  return text.includes("%unk") || text.includes("@unk");
}

function classifyCandidate(item) {
  const canonicalApiId = String(item.canonicalApiId || "").trim();
  if (!canonicalApiId || !canonicalApiId.startsWith("api:project:") || canonicalApiId.includes("%unk") || canonicalApiId.includes("@unk")) {
    return reject("missing_or_unstable_project_canonical_id");
  }
  const method = String(item.method || "").trim();
  const methodLower = method.toLowerCase();
  const argCount = Number(item.argCount || 0);
  const returnType = String(item.returnType || "").trim();
  const returnLower = returnType.toLowerCase();
  const directText = [
    method,
    item.sourceFile,
    item.methodSnippet,
    item.callee_signature,
    (item.topEntries || []).join(" "),
    (item.evidence || []).join(" "),
  ].join("\n").toLowerCase();
  const returnsValue = returnType && !/^void$/.test(returnLower) && !/^promise\s*<\s*void\s*>$/.test(returnLower);
  if (isConstantOrLifecycleOnly(item, directText)) {
    return reject("constant_lifecycle_or_no_data_semantics");
  }
  const preferredSource = classifySource(methodLower, directText, returnsValue);
  if (preferredSource && isSourcePreferredMethod(methodLower)) {
    return accept("source", preferredSource.reason, [{ value: endpointReturn(), key: "return" }], preferredSource.sourceKind);
  }
  const sink = classifySink(methodLower, directText, argCount);
  if (sink) {
    return accept("sink", sink.reason, sink.endpoints, sink.sinkKind);
  }
  const source = preferredSource || classifySource(methodLower, directText, returnsValue);
  if (source) {
    return accept("source", source.reason, [{ value: endpointReturn(), key: "return" }], source.sourceKind);
  }
  const transfer = classifyTransfer(methodLower, directText, returnsValue, argCount);
  if (transfer) {
    return accept("transfer", transfer.reason, transfer.endpoints, transfer.transferKind);
  }
  return reject("insufficient_explicit_taint_semantic_evidence");
}

function classifySink(methodLower, text, argCount) {
  const sinkTokens = [
    "hilog.", "console.", "logger.", ".log(", ".error(", ".warn(",
    "fs.write", "write(", "writefile", "append", "save", "upload", "send",
    "request(", "http.request", "router.push", "pushurl", "navigate",
    "insert(", "update(", "delete(", "remove(", ".set(", ".put(",
    "avplayer", ".url",
  ];
  const methodSink = /^(log|debug|info|warn|error|write|append|save|upload|send|request|insert|update|delete|remove|put|set|push|pushurl|navigate)/.test(methodLower);
  if (!methodSink && !containsAny(text, sinkTokens)) return undefined;
  const endpoints = [];
  const maxArgs = Math.min(Math.max(argCount, 0), 3);
  if (maxArgs === 0) {
    endpoints.push({ value: endpointReceiver(), key: "receiver" });
  } else if (methodLower.includes("write") && maxArgs > 1) {
    endpoints.push({ value: endpointArg(1), key: "arg1" });
    endpoints.push({ value: endpointArg(0), key: "arg0" });
  } else {
    for (let index = 0; index < maxArgs; index++) {
      endpoints.push({ value: endpointArg(index), key: `arg${index}` });
    }
  }
  return { reason: "explicit_outbound_or_persistent_sink_signal", endpoints, sinkKind: inferSinkKind(methodLower, text) };
}

function classifySource(methodLower, text, returnsValue) {
  if (!returnsValue) return undefined;
  const sourceTokens = [
    "getstring", "getnumber", "getboolean", "getvalue", "getitem",
    "query(", "select", "read(", "readsync", "readtext", "readfile",
    "fetch", "download", "response", "result", "body", "data",
    "photoaccesshelper", "picker", "scan", "list", "album", "fileuri",
    "preferences", "datapreferences", "rdb", "database", "http.request",
  ];
  const methodSource = /^(get|read|query|select|fetch|download|load|list|scan|pick|obtain|resolve)/.test(methodLower);
  if (!methodSource && !containsAny(text, sourceTokens)) return undefined;
  return { reason: "explicit_data_acquisition_source_signal", sourceKind: "call_return" };
}

function isSourcePreferredMethod(methodLower) {
  return /^(get|read|query|select|fetch|download|load|list|scan|pick|obtain|resolve)/.test(methodLower);
}

function classifyTransfer(methodLower, text, returnsValue, argCount) {
  if (!returnsValue || argCount <= 0) return undefined;
  const transferTokens = [
    "return ", "encode", "decode", "convert", "parse", "stringify", "normalize",
    "serialize", "deserialize", "map", "transform", "build", "compose", "format",
    "encrypt", "decrypt", "hash", "base64", "arraybuffer", "buffer",
  ];
  const transferName = /(encode|decode|convert|parse|stringify|normalize|serialize|deserialize|map|transform|build|compose|format|encrypt|decrypt|hash|base64|buffer)/.test(methodLower);
  if (!transferName && !containsAny(text, transferTokens)) return undefined;
  const endpoints = [];
  for (let index = 0; index < Math.min(argCount, 3); index++) {
    endpoints.push({
      from: endpointArg(index),
      to: endpointReturn(),
      key: `arg${index}_to_return`,
    });
  }
  return { reason: "input_to_return_wrapper_transfer_signal", endpoints, transferKind: "project-wrapper" };
}

function isConstantOrLifecycleOnly(item, text) {
  const snippet = String(item.methodSnippet || "").toLowerCase();
  if (/return\s+['"`][^'"`]{0,80}['"`]\s*;/.test(snippet) && !/(want|param|arg|data|result|body|file|path|url|token|id|name)/.test(snippet)) {
    return true;
  }
  const method = String(item.method || "").toLowerCase();
  if (/^(oncreate|onacceptwant|abouttoappear|build|onpageshow|onpagehide)$/.test(method) && !/(arg|want|param|data|source|sink|http|rdb|fs\.|hilog|router)/.test(text)) {
    return true;
  }
  return false;
}

function accept(role, reason, endpoints, semanticKind) {
  return {
    accepted: true,
    role,
    reason,
    endpoints,
    semanticKind,
    endpointKey: endpoints.map(endpoint => endpoint.key).join(","),
  };
}

function reject(reason) {
  return { accepted: false, reason };
}

function buildAssetFromDecision(project, item, decision, packId) {
  const canonicalApiId = String(item.canonicalApiId).trim();
  const hash = shortHash(`${canonicalApiId}:${decision.role}:${decision.endpointKey}`);
  const methodId = safeModelId(String(item.method || "api"));
  const assetId = `project.${packId}.${methodId}.${decision.role}.${hash}`;
  const surfaceId = `surface:${canonicalApiId}`;
  const sourceFile = String(item.sourceFile || "");
  const line = firstLineFromSnippet(item.methodSnippet);
  const surface = {
    surfaceId,
    canonicalApiId,
    kind: "invoke",
    confidence: "likely",
    provenance: {
      source: "llm-proposal",
      location: sourceFile ? { file: sourceFile, ...(line ? { line } : {}) } : undefined,
      typeSignature: String(item.callee_signature || ""),
    },
  };
  const bindings = [];
  const effectTemplates = [];
  if (decision.role === "source") {
    const endpoint = decision.endpoints[0].value;
    const templateId = `template.${methodId}.source.${hash}`;
    effectTemplates.push({
      id: templateId,
      kind: "rule.source",
      value: endpoint,
      sourceKind: decision.semanticKind || "call_return",
      confidence: "likely",
    });
    bindings.push(bindingFor(assetId, surfaceId, canonicalApiId, `binding.${methodId}.source.${hash}`, "source", endpoint, templateId, "project.semanticflow.source"));
  } else if (decision.role === "sink") {
    for (const endpoint of decision.endpoints) {
      const endpointHash = shortHash(`${hash}:${endpoint.key}`);
      const templateId = `template.${methodId}.sink.${endpointHash}`;
      effectTemplates.push({
        id: templateId,
        kind: "rule.sink",
        sinkKind: decision.semanticKind || "project",
        value: endpoint.value,
        confidence: "likely",
      });
      bindings.push(bindingFor(assetId, surfaceId, canonicalApiId, `binding.${methodId}.sink.${endpointHash}`, "sink", endpoint.value, templateId, "project.semanticflow.sink"));
    }
  } else if (decision.role === "transfer") {
    for (const endpoint of decision.endpoints) {
      const endpointHash = shortHash(`${hash}:${endpoint.key}`);
      const templateId = `template.${methodId}.transfer.${endpointHash}`;
      effectTemplates.push({
        id: templateId,
        kind: "rule.transfer",
        from: endpoint.from,
        to: endpoint.to,
        transferKind: decision.semanticKind || "project-wrapper",
        confidence: "likely",
      });
      bindings.push(bindingFor(assetId, surfaceId, canonicalApiId, `binding.${methodId}.transfer.${endpointHash}`, "transfer", undefined, templateId, "project.semanticflow.transfer"));
    }
  }
  return {
    asset: {
      id: assetId,
      plane: "rule",
      status: "schema-valid",
      surfaces: [surface],
      bindings,
      effectTemplates,
      relations: [],
      provenance: {
        source: "llm",
        projectId: packId,
        createdAt: new Date().toISOString(),
        createdBy: "codex-offline-asset-producer",
        evidenceLocations: sourceFile ? [{ file: sourceFile, ...(line ? { line } : {}) }] : [],
      },
    },
    bindingCount: bindings.length,
  };
}

function bindingFor(assetId, surfaceId, canonicalApiId, bindingId, role, endpoint, templateId, family) {
  return {
    bindingId,
    surfaceId,
    canonicalApiId,
    assetId,
    plane: "rule",
    role,
    ...(endpoint ? { endpoint } : {}),
    effectTemplateRefs: [templateId],
    semanticsFamily: family,
    completeness: "complete",
    confidence: "likely",
  };
}

function validateAssets(assets) {
  if (assets.length === 0) return { ok: true, errors: [] };
  const { validateAssetDocument } = require(path.join(REPO_ROOT, "out/core/assets/schema/index.js"));
  const errors = [];
  for (const asset of assets) {
    const validation = validateAssetDocument(asset);
    if (!validation.valid) {
      errors.push({ assetId: asset.id, errors: validation.errors, warnings: validation.warnings });
    }
  }
  return { ok: errors.length === 0, errors };
}

function readAnalyzeReport(configRunDir, projectSafe, batchRecord) {
  const candidates = [
    batchRecord?.summaryJson,
    path.join(configRunDir, "runs", projectSafe, "summary", "summary.json"),
    path.join(configRunDir, "runs", projectSafe, "summary.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const report = readJson(candidate);
    return {
      path: candidate,
      report,
      summary: report.summary || report,
      entries: Array.isArray(report.entries) ? report.entries : [],
    };
  }
  return {
    path: candidates[0] || path.join(configRunDir, "runs", projectSafe, "summary", "summary.json"),
    report: {},
    summary: {},
    entries: [],
  };
}

function summarizeConfigRecord(project, config, configRunDir, startedAt, endedMs, extra) {
  const batchRecord = readLastJsonl(path.join(configRunDir, "batch_runs.jsonl"));
  const projectSafe = safeFileName(path.basename(project.localPath));
  const analyzeReport = readAnalyzeReport(configRunDir, projectSafe, batchRecord);
  const summary = analyzeReport.summary;
  const totalFlows = asNumber(batchRecord?.totalFlows) ?? asNumber(summary.totalFlows);
  const partialFlows =
    asNumber(summary.partialFlows)
    ?? asNumber(summary.partialFlowCount)
    ?? asNumber(summary.observedFlowCount);
  const entryObservedFlows = sum(analyzeReport.entries.map(entry => asNumber(entry.flowCount)));
  const observedFlows = (totalFlows ?? 0) + (partialFlows ?? 0) || entryObservedFlows || 0;
  return {
    project: project.project,
    localPath: project.localPath,
    sizeTier: project.sizeTier,
    configId: config.id,
    configLabel: config.label,
    useAssets: config.useAssets,
    executionHandoff: config.executionHandoff,
    currentness: config.currentness,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    elapsedMs: endedMs - Date.parse(startedAt),
    status: batchRecord?.status || extra.status || "unknown",
    exitCode: extra.exitCode,
    error: extra.error || batchRecord?.error || "",
    outputDir: configRunDir,
    summaryJson: analyzeReport.path,
    totalFlows,
    observedFlows,
    partialFlows,
    analysisBudgetExceededCount: asNumber(batchRecord?.analysisBudgetExceededCount),
    semanticFlowItems: asNumber(batchRecord?.semanticFlowItems),
    semanticFlowRuleCandidates: asNumber(batchRecord?.semanticFlowRuleCandidates),
    semanticFlowModeledArtifacts: asNumber(batchRecord?.semanticFlowModeledArtifacts),
    assetCount: extra.assetCount || 0,
    packId: extra.packId || "",
    command: extra.command,
  };
}

function writeSummaries(outputRoot, records, assetRecords) {
  writeJson(path.join(outputRoot, "project_config_records.json"), records);
  writeCsv(path.join(outputRoot, "project_config_records.csv"), records);
  writeJson(path.join(outputRoot, "offline_asset_generation_records.json"), assetRecords);
  writeCsv(path.join(outputRoot, "offline_asset_generation_records.csv"), assetRecords);
  const byConfig = CONFIGS.map(config => {
    const rows = records.filter(row => row.configId === config.id);
    return {
      configId: config.id,
      configLabel: config.label,
      projectRecords: rows.length,
      completed: rows.filter(row => row.status === "done" || row.status === "done_analysis_incomplete" || row.status === "completed").length,
      timeouts: rows.filter(row => String(row.status || "").includes("timeout")).length,
      failed: rows.filter(row => !["done", "done_analysis_incomplete", "completed", "timeout"].includes(String(row.status || "")) && row.status !== "dry_run").length,
      totalFlows: sum(rows.map(row => row.totalFlows)),
      observedFlows: sum(rows.map(row => row.observedFlows)),
      partialFlows: sum(rows.map(row => row.partialFlows)),
      elapsedMs: sum(rows.map(row => row.elapsedMs)),
      projectsWithFlows: rows.filter(row => (row.totalFlows || row.observedFlows || 0) > 0).length,
    };
  });
  writeJson(path.join(outputRoot, "config_summary.json"), byConfig);
  writeCsv(path.join(outputRoot, "config_summary.csv"), byConfig);
  const semanticEffect = compareConfigs(records, "C0_rule_only", "C1_semantic_assets", "3.4.1_semantic_asset_enhancement");
  const udeEffect = compareConfigs(records, "C1_semantic_assets", "C2_semantic_assets_ude", "3.4.2_ude_ablation");
  const oclfsEffect = compareConfigs(records, "C2_semantic_assets_ude", "C3_full", "3.4.2_oclfs_ablation");
  writeJson(path.join(outputRoot, "chapter34_comparison_summary.json"), [semanticEffect, udeEffect, oclfsEffect]);
  writeCsv(path.join(outputRoot, "chapter34_comparison_summary.csv"), [semanticEffect, udeEffect, oclfsEffect]);
}

function compareConfigs(records, leftId, rightId, comparisonId) {
  const leftRows = new Map(records.filter(row => row.configId === leftId).map(row => [row.project, row]));
  const rightRows = new Map(records.filter(row => row.configId === rightId).map(row => [row.project, row]));
  const projects = [...new Set([...leftRows.keys(), ...rightRows.keys()])];
  let leftFlows = 0;
  let rightFlows = 0;
  let leftObserved = 0;
  let rightObserved = 0;
  let improvedProjects = 0;
  for (const project of projects) {
    const left = leftRows.get(project);
    const right = rightRows.get(project);
    const lf = Number(left?.totalFlows || 0);
    const rf = Number(right?.totalFlows || 0);
    const lo = Number(left?.observedFlows || 0);
    const ro = Number(right?.observedFlows || 0);
    leftFlows += lf;
    rightFlows += rf;
    leftObserved += lo;
    rightObserved += ro;
    if (rf > lf || ro > lo) improvedProjects++;
  }
  return {
    comparisonId,
    leftConfig: leftId,
    rightConfig: rightId,
    comparedProjects: projects.length,
    leftTotalFlows: leftFlows,
    rightTotalFlows: rightFlows,
    deltaTotalFlows: rightFlows - leftFlows,
    leftObservedFlows: leftObserved,
    rightObservedFlows: rightObserved,
    deltaObservedFlows: rightObserved - leftObserved,
    relativeTotalFlowChange: leftFlows > 0 ? (rightFlows - leftFlows) / leftFlows : null,
    relativeObservedFlowChange: leftObserved > 0 ? (rightObserved - leftObserved) / leftObserved : null,
    improvedProjects,
  };
}

function loadCandidateSourceManifest(manifestPath) {
  const map = new Map();
  if (!manifestPath) return map;
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`candidate source manifest not found: ${resolved}`);
  }
  const doc = readJson(resolved);
  const items = Array.isArray(doc.items) ? doc.items : [];
  for (const item of items) {
    if (!item || item.status !== "found" || !item.candidatePath) continue;
    const candidatePath = path.resolve(String(item.candidatePath));
    if (!fs.existsSync(candidatePath)) continue;
    for (const key of [item.project, item.inventoryName, item.localPath ? path.basename(item.localPath) : ""]) {
      const text = String(key || "").trim();
      if (text) map.set(text, { ...item, candidatePath, manifestPath: resolved });
    }
  }
  return map;
}

function findCandidateJson(baselineDir, project, opts) {
  const manifestHit = findManifestCandidate(project, opts);
  if (manifestHit) {
    return {
      path: manifestHit.candidatePath,
      source: "candidate_source_manifest",
      manifestPath: manifestHit.manifestPath,
    };
  }
  const projectName = project.project;
  const projectSafe = safeFileName(projectName);
  const candidates = [
    path.join(baselineDir, "runs", projectSafe, "phase1", "feedback", "rule_feedback", "api_modeling_candidates.json"),
    path.join(baselineDir, "runs", projectSafe, "final", "feedback", "rule_feedback", "api_modeling_candidates.json"),
  ];
  for (const item of candidates) {
    if (fs.existsSync(item)) return { path: item, source: "current_baseline", manifestPath: "" };
  }
  const found = [];
  walkFiles(path.join(baselineDir, "runs"), file => {
    if (file.endsWith(path.join("rule_feedback", "api_modeling_candidates.json"))) {
      found.push(file);
    }
  });
  const first = found.sort()[0] || "";
  return first
    ? { path: first, source: "current_baseline_scan", manifestPath: "" }
    : { path: "", source: "missing", manifestPath: "" };
}

function findManifestCandidate(project, opts) {
  const map = opts.candidateSourceMap;
  if (!map || map.size === 0) return undefined;
  for (const key of [project.project, project.inventoryName, path.basename(project.localPath || "")]) {
    const hit = map.get(String(key || "").trim());
    if (hit) return hit;
  }
  return undefined;
}

function latestArtifactForConfig(configRunDir, projectName) {
  const projectSafe = safeFileName(projectName);
  const candidates = [
    path.join(configRunDir, "batch_runs.jsonl"),
    path.join(configRunDir, "runs", projectSafe, "summary.json"),
    path.join(configRunDir, "runs", projectSafe, "stdout.log"),
  ];
  return candidates.find(item => fs.existsSync(item)) || configRunDir;
}

function walkFiles(root, onFile) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) onFile(full);
    }
  }
}

function endpointArg(index) {
  return { base: { kind: "arg", index } };
}

function endpointReturn() {
  return { base: { kind: "return" } };
}

function endpointReceiver() {
  return { base: { kind: "receiver" } };
}

function inferSinkKind(methodLower, text) {
  if (text.includes("hilog") || methodLower.includes("log") || methodLower.includes("error")) return "logging";
  if (text.includes("router") || methodLower.includes("push") || methodLower.includes("navigate")) return "navigation";
  if (text.includes("http") || methodLower.includes("request") || methodLower.includes("upload") || methodLower.includes("send")) return "network";
  if (text.includes("rdb") || methodLower.includes("insert") || methodLower.includes("update")) return "database";
  if (text.includes("fs.") || methodLower.includes("write") || methodLower.includes("save")) return "file";
  return "project";
}

function containsAny(text, tokens) {
  return tokens.some(token => text.includes(token));
}

function shrinkCandidate(item) {
  return {
    canonicalApiId: item.canonicalApiId,
    derivedCanonicalApiId: item.derivedCanonicalApiId,
    derivedCanonicalApiIdEvidence: item.derivedCanonicalApiIdEvidence,
    method: item.method,
    sourceFile: item.sourceFile,
    argCount: item.argCount,
    returnType: item.returnType,
    candidateOrigin: item.candidateOrigin,
    topEntries: item.topEntries,
    callee_signature: item.callee_signature,
  };
}

function firstLineFromSnippet(snippet) {
  const match = String(snippet || "").match(/^\s*(\d+)\s*\|/m);
  return match ? Number(match[1]) : undefined;
}

function prefixLines(text, prefix) {
  return text.split(/(\r?\n)/).map(part => part === "\n" || part === "\r\n" || part.length === 0 ? part : `${prefix}${part}`).join("");
}

function readLastJsonl(file) {
  if (!fs.existsSync(file)) return undefined;
  const lines = fs.readFileSync(file, "utf-8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return undefined;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return undefined;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf-8");
}

function logProgress(file, value) {
  appendJsonl(file, { ts: new Date().toISOString(), ...value });
}

function updateStatus(file, value) {
  writeJson(file, value);
}

function writeCsv(file, rows) {
  ensureDir(path.dirname(file));
  if (!rows || rows.length === 0) {
    fs.writeFileSync(file, "", "utf-8");
    return;
  }
  const keys = [...new Set(rows.flatMap(row => Object.keys(flattenCsvRow(row))))];
  const lines = [keys.join(",")];
  for (const row of rows) {
    const flat = flattenCsvRow(row);
    lines.push(keys.map(key => csvEscape(flat[key])).join(","));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

function flattenCsvRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value === undefined || value === null) out[key] = "";
    else if (typeof value === "object") out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function publicOptions(opts) {
  return {
    projectsCsv: opts.projectsCsv,
    maxProjects: opts.maxProjects,
    startIndex: opts.startIndex,
    projectTimeoutSeconds: opts.projectTimeoutSeconds,
    sourceDirTimeoutSeconds: opts.sourceDirTimeoutSeconds,
    heartbeatSeconds: opts.heartbeatSeconds,
    worklistBudgetMs: opts.worklistBudgetMs,
    worklistMaxVisited: opts.worklistMaxVisited,
    maxEntries: opts.maxEntries,
    maxAssetCandidates: opts.maxAssetCandidates,
    candidateSourceManifest: opts.candidateSourceManifest,
    flowMode: opts.flowMode,
    reportMode: opts.reportMode,
    entryModel: opts.entryModel,
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseIntStrict(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function safeFileName(value) {
  return String(value || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function safeModelId(value) {
  const normalized = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "project";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "");
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function quoteArg(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function asNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
