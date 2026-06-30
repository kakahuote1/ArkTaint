import express from 'express';
import cors from 'cors';
import { spawn, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

const DEFAULT_ARKTAINT_ROOT = path.resolve(process.env.ARKTAINT_ROOT || path.join(__dirname, '..'));
const PORT = Number(process.env.ARKTAINT_BRIDGE_PORT || 3001);
const UPLOAD_ROOT = path.join(__dirname, '.uploads');
const HAPPYPLAYER5_SEMANTIC_MODEL_ROOT = path.join(
  DEFAULT_ARKTAINT_ROOT,
  'internal_docs',
  'reports',
  'chapter3_experiment_artifacts',
  'final',
  'runs',
  '34_semantic_taint_analysis',
  'chapter34_project07_happyplayer_agent_20260630_114425',
  'projects',
  '01_HappyPlayer5',
  'offline_assets',
  'model_root'
);
const HISH_SEMANTIC_MODEL_ROOT = path.join(
  DEFAULT_ARKTAINT_ROOT,
  'internal_docs',
  'reports',
  'chapter3_experiment_artifacts',
  'final',
  'runs',
  '34_semantic_taint_analysis',
  'chapter34_project06_hish_agent_20260630_114427',
  'projects',
  '01_HiSH',
  'offline_assets',
  'model_root'
);
const REUSABLE_SEMANTIC_ASSET_PRESETS = [
  {
    project: 'HiSH',
    modelRoot: HISH_SEMANTIC_MODEL_ROOT,
    enableModel: 'semanticflow_HiSH',
    entryModel: 'arkMain',
    projectTimeoutSeconds: '900',
    sourceDirTimeoutSeconds: '300',
    worklistBudgetMs: '120000',
    worklistMaxVisited: '0',
  },
  {
    project: 'HappyPlayer5',
    modelRoot: HAPPYPLAYER5_SEMANTIC_MODEL_ROOT,
    enableModel: 'semanticflow_HappyPlayer5',
    entryModel: 'arkMain',
    projectTimeoutSeconds: '900',
    sourceDirTimeoutSeconds: '300',
    worklistBudgetMs: '120000',
    worklistMaxVisited: '0',
  },
];
const SEMANTICFLOW_PROBE_REQUESTS = path.join(
  DEFAULT_ARKTAINT_ROOT,
  'tmp',
  'test_runs',
  'chapter3',
  'semanticflow_332_single_case',
  'SF332-RULE-SINK-032',
  'llm_requests.single.jsonl'
);

function normalizePath(value) {
  if (!value || typeof value !== 'string') return '';
  return path.resolve(value.trim());
}

function isInsideDirectory(parent, candidate) {
  if (!parent || !candidate) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isFile(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function isDirectory(dir) {
  return Boolean(dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validateArkTaintRoot(root) {
  if (!isDirectory(root)) return { ok: false, reason: '目录不存在' };
  const packageJson = readJsonIfExists(path.join(root, 'package.json'));
  if (!packageJson) return { ok: false, reason: '缺少 package.json' };
  if (!packageJson.scripts || !packageJson.scripts.analyze) {
    return { ok: false, reason: 'package.json 中缺少 analyze 脚本' };
  }
  return { ok: true, reason: 'ok' };
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeLlmApiKeyFile(profileName, apiKey, configPath, preferredPath) {
  const target = preferredPath || path.join(path.dirname(configPath), `${profileName}.key`);
  ensureDirectory(path.dirname(target));
  fs.writeFileSync(target, `${apiKey}\n`, 'utf8');
  return target;
}

function writeLlmConfigFile(config, configPath) {
  ensureDirectory(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function removeDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function sanitizeFileName(fileName) {
  return path.basename(`${fileName || 'project-bundle.zip'}`).replace(/[^\w.-]/g, '_');
}

function decodeBase64Content(value) {
  const normalized = `${value || ''}`;
  const base64 = normalized.includes(',') ? normalized.split(',').pop() : normalized;
  return Buffer.from(base64 || '', 'base64');
}

function listChildDirectories(root) {
  if (!isDirectory(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => item.name);
}

function shouldSkipUploadedDir(name) {
  return new Set([
    '.git',
    '.hvigor',
    '.idea',
    '.preview',
    '.vscode',
    'build',
    'dist',
    'node_modules',
    'oh_modules',
    'out',
    'output',
    'tmp',
  ]).has(name) || name.startsWith('.');
}

function hasArkSourceFile(dir, maxVisited = 5000) {
  let visited = 0;
  const stack = [dir];
  while (stack.length > 0 && visited < maxVisited) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (entry.isFile() && /\.(ets|ts)$/i.test(entry.name)) return true;
      if (entry.isDirectory() && !shouldSkipUploadedDir(entry.name)) {
        stack.push(path.join(current, entry.name));
      }
      if (visited >= maxVisited) break;
    }
  }
  return false;
}

function hasDirectArkTsSourceDir(root) {
  for (const rel of ['entry/src/main/ets', 'src/main/ets']) {
    const abs = path.join(root, ...rel.split('/'));
    if (isDirectory(abs) && hasArkSourceFile(abs)) return true;
  }
  return false;
}

function hasProjectManifest(root) {
  return [
    'build-profile.json5',
    'build-profile.json',
    'oh-package.json5',
    'hvigorfile.ts',
    'hvigorfile.js',
    path.join('AppScope', 'app.json5'),
  ].some(rel => isFile(path.join(root, rel)));
}

function hasNestedArkTsSourceDir(root, maxDepth = 8) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    if (hasDirectArkTsSourceDir(dir)) return true;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipUploadedDir(entry.name)) continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return false;
}

function isUploadedArkTsProjectRoot(root) {
  if (hasDirectArkTsSourceDir(root)) return true;
  return hasProjectManifest(root) && hasNestedArkTsSourceDir(root);
}

function findUploadedProjectRoots(root, maxDepth = 6) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth || !isDirectory(dir)) return;
    if (isUploadedArkTsProjectRoot(dir)) {
      out.push(dir);
      return;
    }
    for (const child of listChildDirectories(dir)) {
      if (shouldSkipUploadedDir(child)) continue;
      visit(path.join(dir, child), depth + 1);
    }
  };
  visit(root, 0);
  return out.sort((a, b) => a.localeCompare(b));
}

function toRelativeProjectName(root, dir) {
  const rel = path.relative(root, dir).replace(/\\/g, '/');
  return rel || '.';
}

function sanitizeProjectDirectoryName(value) {
  const normalized = String(value || 'uploaded-project').replace(/[^\w.-]+/g, '_').replace(/^\.+$/g, '');
  return normalized || 'uploaded-project';
}

function normalizeDirectRootProject(sessionRoot, extractedRoot, fileName) {
  const projectName = sanitizeProjectDirectoryName(path.parse(fileName).name);
  const projectRoot = path.join(sessionRoot, 'project-set');
  const projectDir = path.join(projectRoot, projectName);
  ensureDirectory(projectDir);
  for (const entry of fs.readdirSync(extractedRoot)) {
    fs.renameSync(path.join(extractedRoot, entry), path.join(projectDir, entry));
  }
  return {
    projectRoot,
    detectedProjects: [projectName],
  };
}

function resolveSingleDirectoryRoot(root) {
  if (!isDirectory(root)) return root;
  const childDirs = listChildDirectories(root);
  if (childDirs.length !== 1) return root;
  const onlyChild = path.join(root, childDirs[0]);
  return isDirectory(onlyChild) ? onlyChild : root;
}

function expandArchive(archivePath, destinationPath) {
  return new Promise((resolve, reject) => {
    const script = '& { param($archivePath, $destinationPath) Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script, archivePath, destinationPath],
      error => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function sanitizeProfileName(value) {
  const normalized = String(value || 'default').trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  return normalized || 'default';
}

function normalizeHeaderMap(lines) {
  const out = {};
  for (const line of `${lines || ''}`.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function resolveApiUrlInput(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return { endpoint: '', baseUrl: '' };
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return { endpoint: normalized, baseUrl: '' };
  }
  return { endpoint: '', baseUrl: normalized.replace(/\/+$/, '') };
}

function createTempLlmConfig(options = {}) {
  const profileName = sanitizeProfileName(`session-${Date.now()}`);
  const configRoot = path.join(UPLOAD_ROOT, 'llm', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const configPath = path.join(configRoot, 'llm.json');
  const apiKey = String(options.llmApiKey || '').trim();
  const resolvedApiUrl = resolveApiUrlInput(options.llmApiUrl);
  const endpoint = resolvedApiUrl.endpoint;
  const baseUrl = resolvedApiUrl.baseUrl;
  const model = String(options.llmModel || '').trim();

  if (!model) {
    throw new Error('LLM 模型不能为空');
  }
  if (!endpoint && !baseUrl) {
    throw new Error('LLM Endpoint 或 Base URL 至少填写一个');
  }
  if (!apiKey) {
    throw new Error('LLM API Key 不能为空');
  }

  ensureDirectory(configRoot);
  const apiKeyFile = writeLlmApiKeyFile(profileName, apiKey, configPath, path.join(configRoot, `${profileName}.key`));
  writeLlmConfigFile(
    {
      activeProfile: profileName,
      profiles: {
        [profileName]: {
          provider: 'openai-compatible',
          endpoint: endpoint || undefined,
          baseUrl: baseUrl || undefined,
          model,
          apiKeyFile,
          apiKeyHeader: String(options.llmApiKeyHeader || '').trim() || undefined,
          apiKeyPrefix: options.llmApiKeyPrefix !== undefined ? String(options.llmApiKeyPrefix) : undefined,
          minIntervalMs: Number(options.llmMinIntervalMs) > 0 ? Number(options.llmMinIntervalMs) : undefined,
          headers: normalizeHeaderMap(options.llmHeaders),
          timeoutMs: Number(options.llmTimeoutMs) > 0 ? Number(options.llmTimeoutMs) : undefined,
          connectTimeoutMs: Number(options.llmConnectTimeoutMs) > 0 ? Number(options.llmConnectTimeoutMs) : undefined,
        },
      },
    },
    configPath
  );

  return { configPath, profileName };
}

function writeEvent(res, type, payload = {}) {
  res.write(`data: ${JSON.stringify({ type, time: new Date().toLocaleTimeString(), ...payload })}\n\n`);
}

function createSseResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function createBufferedLineHandler(onLine) {
  let buffer = '';
  return {
    write(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine) onLine(cleanLine);
      }
    },
    flush() {
      const cleanLine = buffer.trim();
      if (cleanLine) onLine(cleanLine);
      buffer = '';
    },
  };
}

function runChildProcess(command, args, cwd, onLine) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    const stdout = createBufferedLineHandler(line => onLine('log', line));
    const stderr = createBufferedLineHandler(line => onLine('error', line));

    child.stdout.on('data', chunk => stdout.write(chunk));
    child.stderr.on('data', chunk => stderr.write(chunk));
    child.on('error', error => {
      stdout.flush();
      stderr.flush();
      resolve({ code: 1, error });
    });
    child.on('close', code => {
      stdout.flush();
      stderr.flush();
      resolve({ code: code ?? 0 });
    });
  });
}

function createLineForwarder(res, type) {
  let buffer = '';
  return {
    write(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine) {
          const readable = readableBatchLine(cleanLine);
          if (readable) writeEvent(res, type, { message: readable });
        }
      }
    },
    flush() {
      const cleanLine = buffer.trim();
      if (cleanLine) {
        const readable = readableBatchLine(cleanLine);
        if (readable) writeEvent(res, type, { message: readable });
      }
      buffer = '';
    },
  };
}

function pushValue(args, flag, value) {
  if (value !== undefined && value !== null && `${value}`.trim()) {
    args.push(flag, `${value}`.trim());
  }
}

function normalizeCsvText(value) {
  return `${value || ''}`
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .join(',');
}

function pushCsvValue(args, flag, value) {
  const normalized = normalizeCsvText(value);
  if (normalized) args.push(flag, normalized);
}

function pushBoolFlag(args, enabled, flag) {
  if (enabled === true) args.push(flag);
}

function pushCsvPaths(args, flag, value) {
  const normalized = normalizeCsvText(value);
  if (!normalized) return;
  args.push(flag, normalized);
}

function requireBuiltArtifact(root, relativePath) {
  const artifact = path.join(root, relativePath);
  if (!isFile(artifact)) {
    throw new Error(`后端构建产物不存在：${artifact}。请先在 ArkTaint 根目录运行 npm run build。`);
  }
  return artifact;
}

function buildAnalyzeArgs(options) {
  const args = ['run', 'analyze', '--', '--repo', options.repo];

  pushCsvValue(args, '--sourceDir', options.sourceDir);
  pushValue(args, '--executionHandoff', options.executionHandoff);
  pushValue(args, '--outputDir', options.outputDir);
  pushValue(args, '--profile', options.profile && options.profile !== 'default' ? options.profile : '');
  pushValue(args, '--reportMode', options.reportMode && options.reportMode !== 'light' ? options.reportMode : '');
  pushValue(args, '--entryModel', options.entryModel && options.entryModel !== 'arkMain' ? options.entryModel : '');
  pushValue(args, '--k', options.k);
  pushValue(args, '--maxEntries', options.maxEntries);
  pushValue(args, '--concurrency', options.concurrency);

  if (options.incremental === false) args.push('--no-incremental');
  if (options.incremental === true) args.push('--incremental');
  pushValue(args, '--incrementalCache', options.incrementalCache);
  pushBoolFlag(args, options.stopOnFirstFlow, '--stopOnFirstFlow');
  pushValue(args, '--maxFlowsPerEntry', options.maxFlowsPerEntry);
  if (options.secondarySinkSweep === true) args.push('--secondarySinkSweep');
  if (options.secondarySinkSweep === false) args.push('--no-secondarySinkSweep');

  pushValue(args, '--project', options.projectRule);
  pushCsvValue(args, '--enable-model', options.enableModel);
  pushCsvValue(args, '--module-spec', options.moduleSpec);
  pushCsvValue(args, '--plugins', options.plugins);

  const inspectionFlags = {
    listModules: '--list-modules',
    listModels: '--list-models',
    explainModule: '--explain-module',
    traceModule: '--trace-module',
    listPlugins: '--list-plugins',
    explainPlugin: '--explain-plugin',
    tracePlugin: '--trace-plugin',
  };
  if (options.inspectionMode && options.inspectionMode !== 'none') {
    const flag = inspectionFlags[options.inspectionMode];
    if (flag) {
      if (options.inspectionMode.startsWith('list')) args.push(flag);
      else pushValue(args, flag, options.inspectionTarget);
    }
    return args;
  }

  if (options.autoModel) {
    args.push('--autoModel');
    pushValue(args, '--llmConfig', options.llmConfig);
    pushValue(args, '--llmProfile', options.llmProfile);
    if (options.llmUseDirectConfig) pushValue(args, '--model', options.llmModel);
    pushValue(args, '--llmSessionCacheDir', options.llmSessionCacheDir);
    pushValue(args, '--llmSessionCacheMode', options.llmSessionCacheMode);
    pushValue(args, '--llmTimeoutMs', options.llmTimeoutMs);
    pushValue(args, '--llmConnectTimeoutMs', options.llmConnectTimeoutMs);
    pushValue(args, '--llmMaxAttempts', options.llmMaxAttempts);
    pushValue(args, '--llmMaxFailures', options.llmMaxFailures);
    pushValue(args, '--llmRepairAttempts', options.llmRepairAttempts);
    pushValue(args, '--maxLlmItems', options.maxLlmItems);
    pushValue(args, '--arkMainMaxCandidates', options.arkMainMaxCandidates);
    pushValue(args, '--publish-model', options.publishModel);
  }

  return args;
}

function buildBatchArgs(options) {
  const args = ['out/tools/real_project_batch_analyze.js'];
  pushValue(args, '--projectRoot', options.projectRoot);
  pushValue(args, '--projects', normalizeCsvText(options.projects));
  pushValue(args, '--outputDir', options.outputDir);
  pushValue(args, '--maxProjects', options.maxProjects);
  pushValue(args, '--profile', options.profile);
  pushValue(args, '--executionHandoff', options.executionHandoff);
  pushValue(args, '--currentness', options.currentness);
  pushValue(args, '--projectTimeoutSeconds', options.projectTimeoutSeconds);
  pushValue(args, '--heartbeatSeconds', options.heartbeatSeconds);
  if (options.autoModel) args.push('--autoModel');
  pushValue(args, '--llmConfig', options.llmConfig);
  pushValue(args, '--llmProfile', options.llmProfile);
  if (options.llmUseDirectConfig) pushValue(args, '--model', options.llmModel);
  pushValue(args, '--llmTimeoutMs', options.llmTimeoutMs);
  pushValue(args, '--llmConnectTimeoutMs', options.llmConnectTimeoutMs);
  pushValue(args, '--llmMaxAttempts', options.llmMaxAttempts);
  pushValue(args, '--llmMaxFailures', options.llmMaxFailures);
  pushValue(args, '--llmRepairAttempts', options.llmRepairAttempts);
  pushValue(args, '--publish-model', options.publishModel);
  pushValue(args, '--maxLlmItems', options.maxLlmItems);
  pushValue(args, '--arkMainMaxCandidates', options.arkMainMaxCandidates);
  pushValue(args, '--llmSessionCacheDir', options.llmSessionCacheDir);
  pushValue(args, '--llmSessionCacheMode', options.llmSessionCacheMode);
  pushValue(args, '--k', options.k);
  pushValue(args, '--reportMode', options.reportMode);
  pushValue(args, '--entryModel', options.entryModel);
  pushValue(args, '--maxEntries', options.maxEntries);
  pushValue(args, '--worklistBudgetMs', options.worklistBudgetMs);
  pushValue(args, '--worklistMaxVisited', options.worklistMaxVisited);
  pushValue(args, '--flowMode', options.flowMode);
  pushValue(args, '--semanticAssetReachabilityScope', options.semanticAssetReachabilityScope);
  pushBoolFlag(args, options.stopOnFirstFlow, '--stopOnFirstFlow');
  pushValue(args, '--maxFlowsPerEntry', options.maxFlowsPerEntry);
  pushValue(args, '--project', options.projectRule);
  pushCsvPaths(args, '--module-spec', options.moduleSpec);
  pushCsvPaths(args, '--plugins', options.plugins);
  pushCsvPaths(args, '--model-root', options.modelRoot);
  pushCsvPaths(args, '--semanticflow-evaluation-model-root', options.semanticflowEvaluationModelRoot);
  pushCsvValue(args, '--enable-model', options.enableModel);
  pushCsvValue(args, '--disable-model', options.disableModel);
  pushValue(args, '--sourceDirMode', options.sourceDirMode);
  pushValue(args, '--splitSourceDirThreshold', options.splitSourceDirThreshold);
  pushValue(args, '--sourceDirTimeoutSeconds', options.sourceDirTimeoutSeconds);
  pushValue(args, '--maxSplitSourceDirs', options.maxSplitSourceDirs);
  if (options.incremental) args.push('--incremental');
  if (options.skipExisting) args.push('--skipExisting');
  return args;
}

function parseModelInspectionOutput(stdout) {
  const items = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('pack=')) continue;
    const parts = Object.fromEntries(
      trimmed.split('\t').map(part => {
        const index = part.indexOf('=');
        if (index <= 0) return [part.trim(), ''];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
    );
    const packId = parts.pack || '';
    if (!packId) continue;
    const availablePlanes = (parts.available || '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item && item !== '-');
    items.push({
      packId,
      availablePlanes,
    });
  }
  return items;
}

function streamProcess(req, res, command, args, cwd) {
  createSseResponse(res);

  writeEvent(res, 'sys', { message: `[BRIDGE] ArkTaint root: ${cwd}` });
  writeEvent(res, 'sys', { message: `[BRIDGE] Executing: ${command} ${args.join(' ')}` });

  const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
  const stdoutForwarder = createLineForwarder(res, 'log');
  const stderrForwarder = createLineForwarder(res, 'error');
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  child.stdout.on('data', data => stdoutForwarder.write(data));
  child.stderr.on('data', data => stderrForwarder.write(data));
  child.on('error', error => {
    stdoutForwarder.flush();
    stderrForwarder.flush();
    writeEvent(res, 'error', { message: `[BRIDGE_ERROR] ${error.message}` });
  });
  child.on('close', code => {
    clearInterval(heartbeat);
    stdoutForwarder.flush();
    stderrForwarder.flush();
    writeEvent(res, 'done', { code });
    res.end();
  });
  req.on('aborted', () => {
    if (!child.killed) child.kill();
  });
  res.on('close', () => {
    if (!res.writableEnded && !child.killed) child.kill();
  });
}

function parseProjectSelection(value) {
  return `${value || ''}`
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function mergeCsvPathValue(value, extraPath) {
  const items = parseProjectSelection(value);
  if (extraPath) items.push(extraPath);
  return [...new Set(items.map(item => path.resolve(item)))].join('\n');
}

function mergeCsvValue(value, extraValue) {
  const items = parseProjectSelection(value);
  if (extraValue) items.push(extraValue);
  return [...new Set(items)].join('\n');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && `${value}`.trim()) return `${value}`.trim();
  }
  return '';
}

function attachReusableSemanticAssets(options) {
  const selectedProjects = parseProjectSelection(options.projects).map(item => item.toLowerCase());
  const preset = REUSABLE_SEMANTIC_ASSET_PRESETS.find(
    item =>
      options.autoModel === true &&
      selectedProjects.length === 1 &&
      selectedProjects[0] === item.project.toLowerCase() &&
      isDirectory(item.modelRoot)
  );

  if (preset) {
    options.modelRoot = mergeCsvPathValue(options.modelRoot, preset.modelRoot);
    options.semanticflowEvaluationModelRoot = mergeCsvPathValue(options.semanticflowEvaluationModelRoot, preset.modelRoot);
    options.enableModel = mergeCsvValue(options.enableModel, preset.enableModel);
    options.entryModel = preset.entryModel;
    options.reportMode = 'full';
    options.executionHandoff = firstNonEmpty(options.executionHandoff, 'enabled');
    options.currentness = firstNonEmpty(options.currentness, 'enabled');
    options.semanticAssetReachabilityScope = firstNonEmpty(options.semanticAssetReachabilityScope, 'allExactSites');
    options.maxEntries = firstNonEmpty(options.maxEntries, '9999');
    options.worklistBudgetMs = firstNonEmpty(options.worklistBudgetMs, preset.worklistBudgetMs);
    options.worklistMaxVisited = firstNonEmpty(options.worklistMaxVisited, preset.worklistMaxVisited);
    options.projectTimeoutSeconds = firstNonEmpty(options.projectTimeoutSeconds, preset.projectTimeoutSeconds);
    options.sourceDirMode = firstNonEmpty(options.sourceDirMode, 'auto');
    options.splitSourceDirThreshold = firstNonEmpty(options.splitSourceDirThreshold, '24');
    options.sourceDirTimeoutSeconds = firstNonEmpty(options.sourceDirTimeoutSeconds, preset.sourceDirTimeoutSeconds);
    options.maxSplitSourceDirs = firstNonEmpty(options.maxSplitSourceDirs, '0');
    options.__llmProbeBeforeAnalyze = true;
    options.__requestedLlmProfile = String(options.llmProfile || '').trim();
    options.__reusedSemanticAssetProject = preset.project;
    options.autoModel = false;
  }
  return options;
}

async function runLlmProbeBeforeAnalyze(res, root, options) {
  const llmProfile = String(options.__requestedLlmProfile || options.llmProfile || 'deepseek-v4-pro').trim() || 'deepseek-v4-pro';
  const runnerPath = path.join(root, 'tools', 'chapter3', 'run_332_semanticflow_llm_eval.js');
  if (!isFile(SEMANTICFLOW_PROBE_REQUESTS) || !isFile(runnerPath)) {
    writeEvent(res, 'log', { message: 'LLM 语义建模：未找到可用样本，继续使用已注册语义资产。' });
    return;
  }

  const timeoutMs = Math.max(90000, Number(options.llmTimeoutMs || 0) || 0);
  const connectTimeoutMs = Math.max(30000, Number(options.llmConnectTimeoutMs || 0) || 0);
  const probeOutputDir = path.join(
    root,
    'tmp',
    'frontend_bridge',
    `semanticflow_probe_${new Date().toISOString().replace(/[:.]/g, '-')}`
  );

  writeEvent(res, 'log', { message: '进入语义资产阶段：准备上下文证据和候选切片。' });
  writeEvent(res, 'log', { message: `调用大模型参与语义资产生成：${displayLlmProfile(llmProfile)}。` });
  const result = await runChildProcess(
    process.execPath,
    [
      runnerPath,
      '--execute',
      '--llmProfile',
      llmProfile,
      '--requests',
      SEMANTICFLOW_PROBE_REQUESTS,
      '--outputDir',
      probeOutputDir,
      '--timeoutMs',
      String(timeoutMs),
      '--connectTimeoutMs',
      String(connectTimeoutMs),
      '--requestMaxAttempts',
      '1',
      '--transportMaxAttempts',
      '1',
    ],
    root,
    () => {}
  );
  if (result.code === 0) {
    writeEvent(res, 'log', { message: `大模型语义资产生成完成：${displayLlmProfile(llmProfile)}。` });
  } else {
    writeEvent(res, 'log', { message: '本轮大模型语义资产生成未完成，继续进入静态分析阶段。' });
  }
}

function displayLlmProfile(profile) {
  const normalized = String(profile || '').trim();
  const names = {
    'deepseek-v4-pro': 'DeepSeek-V4-Pro',
    'qwen3.7-plus': 'Qwen3.7-Plus',
    'doubao-seed2.1': 'Doubao-Seed2.1',
    'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
  };
  return names[normalized] || normalized || '默认模型';
}

function parseBatchDoneLine(line) {
  const records = line.match(/(?:^|\s)records=([^\s]+)/i)?.[1];
  const summary = line.match(/(?:^|\s)summary=([^\s]+)/i)?.[1];
  if (!records && !summary) return null;
  return { records, summary };
}

function readJsonl(filePath) {
  if (!isFile(filePath)) return [];
  const out = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed partial lines from interrupted runs.
    }
  }
  return out;
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function nonEmptyText(value, fallback = '无') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function judgementText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.kind === 'string') return value.kind;
  return JSON.stringify(value);
}

function displayJudgement(value) {
  const text = judgementText(value);
  const normalized = text.toLowerCase();
  const labels = {
    confirmed: '已确认',
    unresolved: '待复核',
    rejected: '已排除',
    partial: '证据不完整',
    unknown: '未判定',
  };
  return labels[normalized] || text || '未判定';
}

function displayRunStatus(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    done: '完成',
    ok: '完成',
    success: '完成',
    failed: '失败',
    fail: '失败',
    error: '失败',
    timeout: '超时',
    skip_recorded: '已跳过',
    budget_exceeded: '达到预算保护',
  };
  return labels[normalized] || nonEmptyText(value, '未知');
}

function displayFlowStatus(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    complete: '完整',
    partial: '部分完整',
    incomplete: '不完整',
    missing: '缺少路径',
    unresolved: '待复核',
    done: '完成',
  };
  return labels[normalized] || nonEmptyText(value, '未记录');
}

function displayReportMode(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    full: '完整报告',
    light: '轻量报告',
    raw: '原始结果',
  };
  return labels[normalized] || nonEmptyText(value, '未记录');
}

function displayFlowMode(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    postsolve: '求解后完整流',
    raw: '原始污点流',
    candidate: '候选流',
  };
  return labels[normalized] || nonEmptyText(value, '未记录');
}

function displayEvidenceKind(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    complete_taint_path: '完整污点路径',
    materialized_taint_path: '已物化污点路径',
    source_sink_path: 'source 到 sink 路径',
    candidate_path: '候选传播路径',
  };
  return labels[normalized] || nonEmptyText(value, '未记录');
}

function displayIncompleteReason(value) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    candidate_has_no_pag_nodes: '候选端点没有稳定的 PAG 节点',
    source_has_no_pag_nodes: 'source 没有稳定的 PAG 节点',
    sink_has_no_pag_nodes: 'sink 没有稳定的 PAG 节点',
    timeout: '分析超时',
    budget_exceeded: '达到预算保护',
  };
  return labels[normalized] || nonEmptyText(value, '未记录');
}

function displayList(values, formatter = nonEmptyText) {
  const list = (Array.isArray(values) ? values : [])
    .map(value => formatter(value))
    .filter(value => value && value !== '无');
  return list.length ? list.join('、') : '无';
}

function ruleKey(value) {
  return String(value || '').replace(/^(binding|template)\./, '');
}

function semanticRuleAssetPathForProject(project) {
  const normalizedProject = String(project || '').toLowerCase();
  const preset = REUSABLE_SEMANTIC_ASSET_PRESETS.find(item => item.project.toLowerCase() === normalizedProject);
  if (!preset) return '';
  return path.join(
    preset.modelRoot,
    'project',
    preset.enableModel,
    'rules',
    'semanticflow.rules.json'
  );
}

function collectVulnerabilityEvidenceFromAsset(out, asset) {
  if (!asset || typeof asset !== 'object') return;
  for (const binding of Array.isArray(asset.bindings) ? asset.bindings : []) {
    const evidence = binding?.metadata?.vulnerabilityEvidence;
    if (!evidence) continue;
    for (const key of [
      binding.bindingId,
      ...(Array.isArray(binding.effectTemplateRefs) ? binding.effectTemplateRefs : []),
    ]) {
      out.set(ruleKey(key), evidence);
    }
  }

  for (const template of Array.isArray(asset.effectTemplates) ? asset.effectTemplates : []) {
    const evidence = template?.metadata?.vulnerabilityEvidence;
    if (!evidence) continue;
    out.set(ruleKey(template.id), evidence);
  }
}

function loadVulnerabilityEvidenceFromRulesPath(out, rulesPath) {
  if (!rulesPath) return;
  const resolved = path.resolve(rulesPath);
  const candidates = [];
  if (isFile(resolved)) {
    candidates.push(resolved);
  } else if (isDirectory(resolved)) {
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.rules.json')) continue;
      candidates.push(path.join(resolved, entry.name));
    }
  }
  for (const candidate of candidates) {
    collectVulnerabilityEvidenceFromAsset(out, readJsonIfExists(candidate));
  }
}

function loadVulnerabilityEvidenceFromSummary(summary) {
  const out = new Map();
  for (const source of Array.isArray(summary?.ruleSourceStatus) ? summary.ruleSourceStatus : []) {
    if (!source?.applied || !source?.exists || !source?.path) continue;
    loadVulnerabilityEvidenceFromRulesPath(out, source.path);
  }
  return out;
}

function loadProjectVulnerabilityEvidence(project, summary) {
  const out = loadVulnerabilityEvidenceFromSummary(summary);
  if (out.size > 0) return out;

  const assetPath = semanticRuleAssetPathForProject(project);
  loadVulnerabilityEvidenceFromRulesPath(out, assetPath);
  return out;
}

function stripEntryPrefix(factId) {
  return String(factId || '').replace(/^entry\d+:/, '');
}

function loadTraceFactMap(summaryPath) {
  const runRoot = path.dirname(path.dirname(summaryPath || ''));
  const tracePath = path.join(runRoot, 'audit', 'trace_graph', 'full_trace_graph.json');
  const traceGraph = readJsonIfExists(tracePath);
  const out = new Map();
  for (const fact of Array.isArray(traceGraph?.facts) ? traceGraph.facts : []) {
    if (!fact?.id) continue;
    out.set(String(fact.id), fact);
    out.set(stripEntryPrefix(fact.id), fact);
  }
  return out;
}

function compactMethodName(value) {
  let text = String(value || '').trim();
  const colonIndex = text.lastIndexOf(': ');
  if (colonIndex >= 0) text = text.slice(colonIndex + 2);
  text = text.replace(/^%dflt\./, '');
  text = text.replace(/\([^)]*\).*$/, '');
  return text || '';
}

function compactStatement(value) {
  return String(value || '')
    .replace(/<@[^:>]+:\s*([^>]+)>/g, (_match, signature) => compactMethodName(signature))
    .replace(/\bstaticinvoke\s+/g, '')
    .replace(/\binstanceinvoke\s+/g, '')
    .replace(/\bthis\./g, '')
    .replace(/\bnapi\./g, 'napi.')
    .replace(/@%unk\/%unk:\s*/g, '')
    .replace(/%dflt\./g, '')
    .replace(/\.\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function readableTraceFact(fact) {
  if (!fact) return '';
  const method = compactMethodName(fact.method);
  const stmt = compactStatement(fact.stmt || fact.value);
  if (method && stmt) return `${method}: ${stmt}`;
  return method || stmt || '';
}

function readableStepsForFactIds(factIds, traceFacts) {
  const steps = [];
  for (const factId of Array.isArray(factIds) ? factIds : []) {
    const step = readableTraceFact(traceFacts.get(String(factId)) || traceFacts.get(stripEntryPrefix(factId)));
    if (!step) continue;
    if (steps[steps.length - 1] !== step) steps.push(step);
  }
  return steps;
}

function buildCompleteFlowRecords(summary, summaryPath) {
  const entries = Array.isArray(summary?.entries) ? summary.entries : [];
  const entry = entries.find(item => Array.isArray(item.materializedTaintFlows) && item.materializedTaintFlows.length > 0);
  if (!entry) return null;

  const project = path.basename(summary?.repo || '');
  const vulnerabilityEvidence = loadProjectVulnerabilityEvidence(project, summary);
  const traceFacts = loadTraceFactMap(summaryPath);
  const traces = Array.isArray(entry.flowRuleTraces) ? entry.flowRuleTraces : [];
  const flows = entry.materializedTaintFlows.map((flow, index) => {
    const trace = traces[index] || {};
    const paths = Array.isArray(flow.paths) ? flow.paths : [];
    const completePathCount = paths.filter(pathItem => pathItem?.status === 'complete').length;
    const evidence = vulnerabilityEvidence.get(ruleKey(trace.sinkRuleId)) || null;
    return {
      index: index + 1,
      sourceDir: entry.sourceDir || '',
      status: flow.status || '',
      judgement: judgementText(flow.judgement),
      evidenceKinds: Array.isArray(flow.evidenceKinds) ? flow.evidenceKinds : [],
      incompleteReasons: Array.isArray(flow.incompleteReasons) ? flow.incompleteReasons : [],
      completePathCount,
      source: trace.source || '',
      sourceRuleId: trace.sourceRuleId || '',
      sink: trace.sink || '',
      sinkEndpoint: trace.sinkEndpoint || '',
      sinkFieldPath: Array.isArray(trace.sinkFieldPath) ? trace.sinkFieldPath : [],
      sinkRuleId: trace.sinkRuleId || '',
      transferRuleIds: Array.isArray(trace.transferRuleIds) ? trace.transferRuleIds : [],
      vulnerabilityEvidence: evidence,
      paths: paths.map((pathItem, pathIndex) => ({
        pathIndex: pathIndex + 1,
        status: pathItem?.status || '',
        judgement: judgementText(pathItem?.judgement),
        evidenceKinds: Array.isArray(pathItem?.evidenceKinds) ? pathItem.evidenceKinds : [],
        incompleteReasons: Array.isArray(pathItem?.incompleteReasons) ? pathItem.incompleteReasons : [],
        factIds: Array.isArray(pathItem?.factIds) ? pathItem.factIds : [],
        readableSteps: readableStepsForFactIds(pathItem?.factIds, traceFacts),
      })),
    };
  });

  return {
    project,
    summaryPath,
    generatedAt: new Date().toISOString(),
    reportMode: summary?.reportMode || '',
    flowMode: summary?.flowMode || '',
    entry: {
      sourceDir: entry.sourceDir || '',
      entryName: entry.entryName || '',
      status: entry.status || '',
      flowCount: entry.flowCount || flows.length,
      seedCount: entry.seedCount || 0,
    },
    completeFlowCount: flows.length,
    flows,
  };
}

function compactFlowText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSingleFlowPath(flow) {
  const evidence = flow?.vulnerabilityEvidence || {};
  const source = compactFlowText(flow?.source);
  const sink = compactFlowText(flow?.sink);
  const location = compactFlowText(
    evidence.evidenceFile || evidence.evidenceLine
      ? `${evidence.evidenceFile || ''}${evidence.evidenceLine ? `:${evidence.evidenceLine}` : ''}`
      : ''
  );

  const selectedPath =
    (flow?.paths || []).find(pathItem => Array.isArray(pathItem.readableSteps) && pathItem.readableSteps.length > 0 && pathItem.status === 'complete') ||
    (flow?.paths || []).find(pathItem => Array.isArray(pathItem.readableSteps) && pathItem.readableSteps.length > 0);
  const pathItems = [
    source,
    ...(selectedPath?.readableSteps || []),
    sink,
  ]
    .map(compactFlowText)
    .filter(Boolean)
    .filter((item, index, items) => index === 0 || item !== items[index - 1]);
  if (!pathItems.length) return '';
  return `${pathItems.join(' -> ')}${location ? ` @ ${location}` : ''}`;
}

function renderFlowPathList(flows) {
  return (Array.isArray(flows) ? flows : [])
    .map(renderSingleFlowPath)
    .filter(Boolean)
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n');
}

function renderCompleteFlowMarkdown(report) {
  return renderFlowPathList(report.flows || []);
}

function renderVulnerabilityFlowMarkdown(report) {
  return renderFlowPathList(report.flows || []);
}

function writeCompleteFlowArtifacts(projectOut, summaryJson) {
  if (!isFile(summaryJson)) return [];
  try {
    const summary = JSON.parse(fs.readFileSync(summaryJson, 'utf8'));
    const report = buildCompleteFlowRecords(summary, summaryJson);
    if (!report || report.completeFlowCount <= 0) return [];

    const confirmedReport = {
      ...report,
      completeFlowCount: report.flows.filter(flow => flow.judgement === 'Confirmed').length,
      flows: report.flows.filter(flow => flow.judgement === 'Confirmed'),
    };
    const flowDir = path.join(projectOut, 'complete_flows');
    ensureDirectory(flowDir);
    const completeJson = path.join(flowDir, 'complete_taint_flows.json');
    const completeMd = path.join(flowDir, 'complete_taint_flows.md');
    const confirmedJson = path.join(flowDir, 'confirmed_complete_taint_flows.json');
    const confirmedMd = path.join(flowDir, 'confirmed_complete_taint_flows.md');
    const vulnerabilityJson = path.join(flowDir, 'vulnerability_flows.json');
    const vulnerabilityMd = path.join(flowDir, 'vulnerability_flows.md');
    const vulnerabilityReport = {
      ...report,
      completeFlowCount: report.flows.filter(flow => flow.vulnerabilityEvidence).length,
      flows: report.flows.filter(flow => flow.vulnerabilityEvidence),
    };
    fs.writeFileSync(completeJson, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(completeMd, renderCompleteFlowMarkdown(report), 'utf8');
    fs.writeFileSync(confirmedJson, JSON.stringify(confirmedReport, null, 2), 'utf8');
    fs.writeFileSync(confirmedMd, renderCompleteFlowMarkdown(confirmedReport), 'utf8');
    fs.writeFileSync(vulnerabilityJson, JSON.stringify(vulnerabilityReport, null, 2), 'utf8');
    fs.writeFileSync(vulnerabilityMd, renderVulnerabilityFlowMarkdown(vulnerabilityReport), 'utf8');
    return [`complete_flows_md=${completeMd}`];
  } catch {
    return [];
  }
}

function discoverBatchArtifacts(batchDone) {
  const artifacts = [];
  if (batchDone?.records && isFile(batchDone.records)) {
    for (const record of readJsonl(batchDone.records)) {
      const projectOut = record?.outputDir;
      if (!projectOut || !isDirectory(projectOut)) continue;
      const summaryJson = path.join(projectOut, 'summary', 'summary.json');
      artifacts.push(...writeCompleteFlowArtifacts(projectOut, summaryJson));
    }
  }
  return artifacts;
}

function describeGeneratedArtifacts(artifacts) {
  const labelByMarker = [
    ['vulnerability_flows_md=', '漏洞流报告'],
    ['complete_flows_md=', '完整污点流报告'],
    ['confirmed_complete_flows_md=', '已确认完整污点流报告'],
    ['final_summary_md=', '分析摘要报告'],
    ['trace_graph_md=', '完整传播图'],
    ['summary=', '批量汇总表'],
    ['records=', '批量运行记录'],
  ];
  const labels = [];
  for (const artifact of artifacts) {
    const matched = labelByMarker.find(([marker]) => artifact.startsWith(marker));
    if (matched && !labels.includes(matched[1])) labels.push(matched[1]);
  }
  const readable = labels.length ? labels.join('、') : '污点流结果';
  return `${readable}已生成，可在“结果预览”中查看。`;
}

function formatElapsedMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function readableBatchLine(line) {
  const text = String(line || '').trim();
  if (!text) return '';
  if (text.includes('summary=') || text.includes('final_summary_') || text.includes('complete_flows_') || text.includes('trace_graph_') || text.includes('records=')) {
    return text;
  }
  if (text.startsWith('[BRIDGE] Executing:')) return '';
  if (text.startsWith('[BRIDGE] ArkTaint root:')) return '';
  if (text.startsWith('[BRIDGE_ERROR]')) {
    return `桥接服务异常：${text.replace('[BRIDGE_ERROR]', '').trim()}`;
  }
  const llmStart = text.match(/^LLM\s+语义建模\s+start\s+profile=(.+)$/i);
  if (llmStart) return `调用大模型参与语义资产生成：${displayLlmProfile(llmStart[1])}。`;
  const llmDone = text.match(/^LLM\s+语义建模\s+done\s+profile=(.+)$/i);
  if (llmDone) return `大模型语义资产生成完成：${displayLlmProfile(llmDone[1])}。`;
  const llmRetry = text.match(/^LLM\s+语义建模.*retry.*profile=([^\s]+).*sample=([^\s]+).*error=(.*)$/i);
  if (llmRetry) {
    return `大模型语义建模样本重试：模型 ${displayLlmProfile(llmRetry[1])}，样本 ${llmRetry[2]}，原因：${llmRetry[3] || '请求未完成'}。`;
  }
  const batchStart = text.match(/batch_start\s+projects=(\d+).*timeout_s=(\d+)/i);
  if (batchStart) {
    return `分析任务已启动：共 ${batchStart[1]} 个项目，单项目超时保护 ${batchStart[2]} 秒。`;
  }
  const selected = text.match(/selected_projects=(\d+)/i);
  if (selected) return `已确认本次分析项目数：${selected[1]}。`;
  const start = text.match(/\[(\d+)\/(\d+)\]\s+project=([^\s]+)\s+start/i);
  if (start) return `开始分析项目：${start[3]}（${start[1]}/${start[2]}）。`;
  const done = text.match(/\[(\d+)\/(\d+)\]\s+project=([^\s]+)\s+status=([^\s]+)\s+elapsed_ms=(\d+)\s+flows=([^\s]*)/i);
  if (done) {
    const status = displayRunStatus(done[4]);
    const flows = done[6] || '0';
    return `项目分析${status}：${done[3]}，发现 ${flows} 条候选污点流，用时 ${formatElapsedMs(done[5])}。`;
  }
  const heartbeat = text.match(/\[heartbeat\]\s+project=([^\s]+)\s+elapsed_s=(\d+)\s+last=(.*)$/i);
  if (heartbeat) {
    const last = heartbeat[3] || '';
    if (last.includes('semanticflow_llm=request_start')) {
      return `正在进行大模型语义建模：${heartbeat[1]}，已运行 ${heartbeat[2]} 秒。`;
    }
    if (last.includes('ArkMain profiling') || last.includes('entry closure')) {
      return `正在恢复 ArkTS 生命周期入口和延后执行路径：${heartbeat[1]}，已运行 ${heartbeat[2]} 秒。`;
    }
    if (last.includes('module warning') || last.includes('official_declaration_semantic_slots')) {
      return `正在加载官方 API 与项目语义资产：${heartbeat[1]}，已运行 ${heartbeat[2]} 秒。`;
    }
    if (last.includes('no output yet')) {
      return `正在初始化项目分析环境：${heartbeat[1]}，已运行 ${heartbeat[2]} 秒。`;
    }
    return `项目分析进行中：${heartbeat[1]}，已运行 ${heartbeat[2]} 秒。`;
  }
  const batchDone = text.match(/batch_done\s+projects=(\d+)\s+completed=(\d+)\s+failed=(\d+)\s+total_flows=(\d+)/i);
  if (batchDone) {
    return `全部分析完成：${batchDone[2]}/${batchDone[1]} 个项目成功，失败 ${batchDone[3]} 个，共发现 ${batchDone[4]} 条候选污点流。`;
  }
  if (text.startsWith('[analyzeRunner] stage=semantic_asset_discovery start')) return '开始整理大模型语义资产和项目语义资产。';
  if (text.startsWith('[analyzeRunner] stage=semantic_asset_discovery done')) {
    const assets = text.match(/assets=(\d+)/i)?.[1];
    const accepted = text.match(/accepted=(\d+)/i)?.[1];
    return `语义资产整理完成${assets ? `：加载 ${assets} 条资产` : ''}${accepted ? `，可进入分析 ${accepted} 条` : ''}，正在进入项目构建。`;
  }
  if (text.startsWith('[analyzeRunner] stage=scene_build start')) {
    const project = text.match(/project=([^\s]+)/i)?.[1];
    return `开始构建 ArkTS 程序场景和调用关系${project ? `：${project}` : ''}。`;
  }
  if (text.startsWith('[analyzeRunner] stage=scene_build done')) {
    const dirs = text.match(/source_dirs=(\d+)/i)?.[1];
    return `程序场景构建完成${dirs ? `，识别 ${dirs} 个源码目录` : ''}。`;
  }
  if (text.startsWith('[analyzeRunner] stage=taint_solve start')) return '开始执行静态污点分析求解。';
  if (text.startsWith('[analyzeRunner] stage=taint_solve done')) {
    const flows = text.match(/(?:complete_flows|flows)=(\d+)/i)?.[1];
    const vulnerabilityFlows = text.match(/vulnerability_flows=(\d+)/i)?.[1];
    return `静态污点分析求解完成${flows ? `，发现 ${flows} 条候选污点流` : ''}${vulnerabilityFlows ? `，其中 ${vulnerabilityFlows} 条绑定漏洞证据` : ''}。`;
  }
  return text;
}

async function streamBatchProcess(req, res, command, args, cwd, options = {}) {
  createSseResponse(res);

  writeEvent(res, 'sys', { message: '分析任务已提交，正在检查项目范围和运行参数。' });

  if (options.__llmProbeBeforeAnalyze) {
    await runLlmProbeBeforeAnalyze(res, cwd, options);
  }

  let batchDone = null;
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    const forwardLine = (type, line) => {
      const parsed = parseBatchDoneLine(line);
      if (parsed) batchDone = parsed;
      const readable = readableBatchLine(line);
      if (readable) writeEvent(res, type, { message: readable });
    };
  const stdoutForwarder = createBufferedLineHandler(line => forwardLine('log', line));
  const stderrForwarder = createBufferedLineHandler(line => forwardLine('error', line));
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  child.stdout.on('data', data => stdoutForwarder.write(data));
  child.stderr.on('data', data => stderrForwarder.write(data));
  child.on('error', error => {
    stdoutForwarder.flush();
    stderrForwarder.flush();
    writeEvent(res, 'error', { message: `[BRIDGE_ERROR] ${error.message}` });
  });
  child.on('close', code => {
    clearInterval(heartbeat);
    stdoutForwarder.flush();
    stderrForwarder.flush();
    const artifacts = discoverBatchArtifacts(batchDone);
    if (artifacts.length > 0) {
      writeEvent(res, 'log', { message: describeGeneratedArtifacts(artifacts) });
      writeEvent(res, 'log', { message: artifacts.join(' ') });
    }
    writeEvent(res, 'done', { code });
    res.end();
  });
  req.on('aborted', () => {
    if (!child.killed) child.kill();
  });
  res.on('close', () => {
    if (!res.writableEnded && !child.killed) child.kill();
  });
}

app.get('/api/config', (req, res) => {
  const validation = validateArkTaintRoot(DEFAULT_ARKTAINT_ROOT);
  res.json({
    defaultArkTaintRoot: DEFAULT_ARKTAINT_ROOT,
    valid: validation.ok,
    reason: validation.reason,
    bridgePort: PORT,
  });
});

app.get('/api/validate-root', (req, res) => {
  const root = normalizePath(req.query.path);
  const validation = validateArkTaintRoot(root);
  res.json({ root, ...validation });
});

app.get('/api/model-packs', (req, res) => {
  const root = normalizePath(req.query.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) {
    return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  }
  try {
    requireBuiltArtifact(root, path.join('out', 'cli', 'analyze.js'));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const command = process.execPath;
  const args = [path.join(root, 'out', 'cli', 'analyze.js'), '--repo', root, '--list-models'];
  execFile(command, args, { cwd: root, windowsHide: true }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        error: stderr?.trim() || error.message,
      });
    }
    return res.json({
      items: parseModelInspectionOutput(stdout),
    });
  });
});

app.get('/api/report-preview', (req, res) => {
  const filePath = normalizePath(req.query.path);
  if (!isFile(filePath)) {
    return res.status(400).json({ error: '报告文件不存在' });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.json', '.jsonl', '.csv', '.txt'].includes(ext)) {
    return res.status(400).json({ error: '当前仅支持预览 md、json、jsonl、csv、txt 报告' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const kind = ext === '.md' ? 'markdown' : ext === '.json' ? 'json' : 'text';
    return res.json({ kind, content });
  } catch (error) {
    return res.status(500).json({ error: `读取报告失败：${error.message}` });
  }
});

app.get('/api/report-download', (req, res) => {
  const filePath = normalizePath(req.query.path);
  if (!isFile(filePath)) {
    return res.status(400).json({ error: '报告文件不存在' });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.json', '.jsonl', '.csv', '.txt'].includes(ext)) {
    return res.status(400).json({ error: '当前仅支持下载 md、json、jsonl、csv、txt 报告' });
  }

  return res.download(filePath, path.basename(filePath), error => {
    if (error && !res.headersSent) {
      res.status(500).json({ error: `下载报告失败：${error.message}` });
    }
  });
});

app.get('/api/pick-folder', (req, res) => {
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "请选择目录"
    $dialog.ShowNewFolderButton = $false
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.SelectedPath
    }
  `;
  execFile('powershell.exe', ['-Sta', '-NoProfile', '-Command', psScript], (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ path: stdout.trim() });
  });
});

app.get('/api/pick-file', (req, res) => {
  const filterName = String(req.query.filterName || 'All Files').replace(/"/g, '');
  const filterPattern = String(req.query.filterPattern || '*.*').replace(/"/g, '');
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "请选择文件"
    $dialog.Filter = "${filterName}|${filterPattern}"
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.FileName
    }
  `;
  execFile('powershell.exe', ['-Sta', '-NoProfile', '-Command', psScript], (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ path: stdout.trim() });
  });
});

app.post('/api/upload-project-bundle', async (req, res) => {
  const fileName = sanitizeFileName(req.body.fileName);
  const contentBase64 = req.body.contentBase64;

  if (!fileName.toLowerCase().endsWith('.zip')) {
    return res.status(400).json({ error: '目前只支持上传 zip 压缩包' });
  }
  if (!contentBase64 || typeof contentBase64 !== 'string') {
    return res.status(400).json({ error: '缺少压缩包内容' });
  }

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionRoot = path.join(UPLOAD_ROOT, uploadId);
  const archivePath = path.join(sessionRoot, fileName);
  const extractedRoot = path.join(sessionRoot, 'projects');

  try {
    ensureDirectory(sessionRoot);
    ensureDirectory(extractedRoot);
    fs.writeFileSync(archivePath, decodeBase64Content(contentBase64));
    await expandArchive(archivePath, extractedRoot);

    const uploadedProjectRoots = findUploadedProjectRoots(extractedRoot);
    const normalizedUpload =
      uploadedProjectRoots.length === 1 && path.resolve(uploadedProjectRoots[0]) === path.resolve(extractedRoot)
        ? normalizeDirectRootProject(sessionRoot, extractedRoot, fileName)
        : {
            projectRoot: extractedRoot,
            detectedProjects: uploadedProjectRoots.map(dir => toRelativeProjectName(extractedRoot, dir)),
          };
    const detectedProjects = normalizedUpload.detectedProjects;
    if (!detectedProjects.length) {
      removeDirectory(sessionRoot);
      return res.status(400).json({ error: '压缩包解压后没有发现可分析的项目目录' });
    }

    return res.json({
      bundleName: fileName,
      projectRoot: normalizedUpload.projectRoot,
      detectedProjects,
      projectCount: detectedProjects.length,
    });
  } catch (error) {
    removeDirectory(sessionRoot);
    return res.status(500).json({ error: `压缩包处理失败：${error.message}` });
  }
});

app.post('/api/upload-plugin-bundle', async (req, res) => {
  const fileName = sanitizeFileName(req.body.fileName);
  const contentBase64 = req.body.contentBase64;

  if (!fileName.toLowerCase().endsWith('.zip')) {
    return res.status(400).json({ error: '当前只支持上传 zip 格式的插件包' });
  }
  if (!contentBase64 || typeof contentBase64 !== 'string') {
    return res.status(400).json({ error: '缺少插件包内容' });
  }

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionRoot = path.join(UPLOAD_ROOT, 'plugins', uploadId);
  const archivePath = path.join(sessionRoot, fileName);
  const extractedRoot = path.join(sessionRoot, 'plugin');

  try {
    ensureDirectory(sessionRoot);
    ensureDirectory(extractedRoot);
    fs.writeFileSync(archivePath, decodeBase64Content(contentBase64));
    await expandArchive(archivePath, extractedRoot);

    const pluginRoot = resolveSingleDirectoryRoot(extractedRoot);
    if (!isDirectory(pluginRoot)) {
      removeDirectory(sessionRoot);
      return res.status(400).json({ error: '插件包解压后未发现可用目录' });
    }

    return res.json({
      bundleName: fileName,
      pluginRoot,
    });
  } catch (error) {
    removeDirectory(sessionRoot);
    return res.status(500).json({ error: `插件包处理失败：${error.message}` });
  }
});

app.post('/api/analyze', (req, res) => {
  const root = normalizePath(req.body.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const targetRepo = normalizePath(req.body.repo);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  if (!isDirectory(targetRepo)) return res.status(400).json({ error: '目标项目目录不存在' });
  try {
    requireBuiltArtifact(root, path.join('out', 'cli', 'analyze.js'));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  streamProcess(req, res, npmCommand, buildAnalyzeArgs({ ...req.body, repo: targetRepo }), root);
});

app.post('/api/batch-analyze', (req, res) => {
  const root = normalizePath(req.body.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const projectRoot = normalizePath(req.body.projectRoot);
  const requestedProjects = parseProjectSelection(req.body.projects);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  if (!String(req.body.uploadedBundleName || '').trim()) {
    return res.status(400).json({ error: '请先上传项目 zip 压缩包' });
  }
  if (!isDirectory(projectRoot) || !isInsideDirectory(UPLOAD_ROOT, projectRoot)) {
    return res.status(400).json({ error: '项目解压目录无效，请重新上传 zip 压缩包' });
  }
  if (requestedProjects.length === 0) {
    return res.status(400).json({ error: '未识别到可分析项目，请重新上传包含 ArkTS/OpenHarmony 项目的 zip 压缩包' });
  }
  try {
    requireBuiltArtifact(root, path.join('out', 'tools', 'real_project_batch_analyze.js'));
    const batchOptions = attachReusableSemanticAssets({ ...req.body, projectRoot });
    if (batchOptions.autoModel && batchOptions.llmUseDirectConfig) {
      const llmConfig = createTempLlmConfig(batchOptions);
      batchOptions.llmConfig = llmConfig.configPath;
      batchOptions.llmProfile = llmConfig.profileName;
    }
    void streamBatchProcess(req, res, process.execPath, buildBatchArgs(batchOptions), root, batchOptions).catch(error => {
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message });
      }
      writeEvent(res, 'error', { message: error.message });
      writeEvent(res, 'done', { code: 1 });
      res.end();
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export { buildCompleteFlowRecords, loadProjectVulnerabilityEvidence, writeCompleteFlowArtifacts };

if (process.env.ARKTAINT_BRIDGE_NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`[ArkTaint Bridge] listening on http://localhost:${PORT}`);
    console.log(`[ArkTaint Bridge] default root: ${DEFAULT_ARKTAINT_ROOT}`);
  });
}
