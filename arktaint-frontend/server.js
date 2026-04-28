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
app.use(express.json({ limit: '1mb' }));

const DEFAULT_ARKTAINT_ROOT = path.resolve(process.env.ARKTAINT_ROOT || path.join(__dirname, '..'));
const PORT = Number(process.env.ARKTAINT_BRIDGE_PORT || 3001);

function normalizePath(value) {
  if (!value || typeof value !== 'string') return '';
  return path.resolve(value.trim());
}

function isDirectory(dir) {
  return Boolean(dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function writeEvent(res, type, payload = {}) {
  res.write(`data: ${JSON.stringify({ type, time: new Date().toLocaleTimeString(), ...payload })}\n\n`);
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
        if (cleanLine) writeEvent(res, type, { message: cleanLine });
      }
    },
    flush() {
      const cleanLine = buffer.trim();
      if (cleanLine) writeEvent(res, type, { message: cleanLine });
      buffer = '';
    }
  };
}

function pushValue(args, flag, value) {
  if (value !== undefined && value !== null && `${value}`.trim()) {
    args.push(flag, `${value}`.trim());
  }
}

function normalizeCsvText(value) {
  return `${value || ''}`.split('\n').map(item => item.trim()).filter(Boolean).join(',');
}

function pushCsvValue(args, flag, value) {
  const normalized = normalizeCsvText(value);
  if (normalized) args.push(flag, normalized);
}

function pushBoolFlag(args, enabled, flag) {
  if (enabled === true) args.push(flag);
}

function buildAnalyzeArgs(options) {
  const args = ['run', 'analyze', '--', '--repo', options.repo];

  pushCsvValue(args, '--sourceDir', options.sourceDir);
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

  pushValue(args, '--kernelRule', options.kernelRule);
  pushValue(args, '--project', options.projectRule);
  pushValue(args, '--candidate', options.candidateRule);
  pushCsvValue(args, '--model-root', options.modelRoot);
  pushCsvValue(args, '--enable-model', options.enableModel);
  pushCsvValue(args, '--disable-model', options.disableModel);
  pushCsvValue(args, '--module-spec', options.moduleSpec);
  pushCsvValue(args, '--disable-module', options.disableModule);
  pushCsvValue(args, '--arkmain-spec', options.arkmainSpec);

  pushCsvValue(args, '--plugins', options.plugins);
  pushCsvValue(args, '--disable-plugins', options.disablePlugins);
  pushCsvValue(args, '--plugin-isolate', options.pluginIsolate);
  pushBoolFlag(args, options.pluginDryRun, '--plugin-dry-run');
  pushBoolFlag(args, options.pluginAudit, '--plugin-audit');

  const inspectionFlags = {
    listModules: '--list-modules',
    listModels: '--list-models',
    explainModule: '--explain-module',
    traceModule: '--trace-module',
    listPlugins: '--list-plugins',
    explainPlugin: '--explain-plugin',
    tracePlugin: '--trace-plugin'
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
    pushValue(args, '--model', options.llmModel);
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
  pushValue(args, '--projectTimeoutSeconds', options.projectTimeoutSeconds);
  pushValue(args, '--heartbeatSeconds', options.heartbeatSeconds);
  if (options.autoModel) args.push('--autoModel');
  pushValue(args, '--llmProfile', options.llmProfile);
  pushValue(args, '--model', options.llmModel);
  pushValue(args, '--llmTimeoutMs', options.llmTimeoutMs);
  pushValue(args, '--llmMaxAttempts', options.llmMaxAttempts);
  pushValue(args, '--llmMaxFailures', options.llmMaxFailures);
  pushValue(args, '--llmRepairAttempts', options.llmRepairAttempts);
  pushValue(args, '--maxLlmItems', options.maxLlmItems);
  pushValue(args, '--concurrency', options.concurrency);
  pushValue(args, '--reportMode', options.reportMode);
  pushValue(args, '--entryModel', options.entryModel);
  pushValue(args, '--maxEntries', options.maxEntries);
  pushValue(args, '--sourceDirMode', options.sourceDirMode);
  pushValue(args, '--splitSourceDirThreshold', options.splitSourceDirThreshold);
  pushValue(args, '--sourceDirTimeoutSeconds', options.sourceDirTimeoutSeconds);
  pushValue(args, '--maxSplitSourceDirs', options.maxSplitSourceDirs);
  if (options.incremental) args.push('--incremental');
  if (options.skipExisting) args.push('--skipExisting');
  return args;
}

function streamProcess(req, res, command, args, cwd) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

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
  req.on('close', () => {
    if (!child.killed) child.kill();
  });
}

app.get('/api/config', (req, res) => {
  const validation = validateArkTaintRoot(DEFAULT_ARKTAINT_ROOT);
  res.json({ defaultArkTaintRoot: DEFAULT_ARKTAINT_ROOT, valid: validation.ok, reason: validation.reason, bridgePort: PORT });
});

app.get('/api/validate-root', (req, res) => {
  const root = normalizePath(req.query.path);
  const validation = validateArkTaintRoot(root);
  res.json({ root, ...validation });
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

app.post('/api/analyze', (req, res) => {
  const root = normalizePath(req.body.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const targetRepo = normalizePath(req.body.repo);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  if (!isDirectory(targetRepo)) return res.status(400).json({ error: '目标项目目录不存在' });
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  streamProcess(req, res, npmCommand, buildAnalyzeArgs({ ...req.body, repo: targetRepo }), root);
});

app.post('/api/batch-analyze', (req, res) => {
  const root = normalizePath(req.body.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const projectRoot = normalizePath(req.body.projectRoot);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  if (!isDirectory(projectRoot)) return res.status(400).json({ error: '项目集合目录不存在' });
  streamProcess(req, res, process.execPath, buildBatchArgs({ ...req.body, projectRoot }), root);
});

app.listen(PORT, () => {
  console.log(`[ArkTaint Bridge] listening on http://localhost:${PORT}`);
  console.log(`[ArkTaint Bridge] default root: ${DEFAULT_ARKTAINT_ROOT}`);
});