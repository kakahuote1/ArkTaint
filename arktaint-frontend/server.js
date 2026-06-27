import express from 'express';
import cors from 'cors';
import { spawn, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { writeLlmApiKeyFile, writeLlmConfigFile } from '../out/cli/llmConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

const DEFAULT_ARKTAINT_ROOT = path.resolve(process.env.ARKTAINT_ROOT || path.join(__dirname, '..'));
const PORT = Number(process.env.ARKTAINT_BRIDGE_PORT || 3001);
const UPLOAD_ROOT = path.join(__dirname, '.uploads');

function normalizePath(value) {
  if (!value || typeof value !== 'string') return '';
  return path.resolve(value.trim());
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

function resolveSingleDirectoryRoot(root) {
  if (!isDirectory(root)) return root;
  const childDirs = listChildDirectories(root);
  if (childDirs.length !== 1) return root;
  const onlyChild = path.join(root, childDirs[0]);
  return isDirectory(onlyChild) ? onlyChild : root;
}

function expandArchive(archivePath, destinationPath) {
  return new Promise((resolve, reject) => {
    const script = 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force';
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
  if (!['.md', '.json', '.txt'].includes(ext)) {
    return res.status(400).json({ error: '当前仅支持预览 md、json、txt 报告' });
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
  if (!['.md', '.json', '.txt'].includes(ext)) {
    return res.status(400).json({ error: '当前仅支持下载 md、json、txt 报告' });
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

    const detectedProjects = listChildDirectories(extractedRoot);
    if (!detectedProjects.length) {
      removeDirectory(sessionRoot);
      return res.status(400).json({ error: '压缩包解压后没有发现可分析的项目目录' });
    }

    return res.json({
      bundleName: fileName,
      projectRoot: extractedRoot,
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
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  streamProcess(req, res, npmCommand, buildAnalyzeArgs({ ...req.body, repo: targetRepo }), root);
});

app.post('/api/batch-analyze', (req, res) => {
  const root = normalizePath(req.body.arktaintRoot || DEFAULT_ARKTAINT_ROOT);
  const projectRoot = normalizePath(req.body.projectRoot);
  const rootValidation = validateArkTaintRoot(root);
  if (!rootValidation.ok) return res.status(400).json({ error: `ArkTaint 根目录无效：${rootValidation.reason}` });
  if (!isDirectory(projectRoot)) return res.status(400).json({ error: '项目集合目录不存在' });
  try {
    const batchOptions = { ...req.body, projectRoot };
    if (batchOptions.autoModel && batchOptions.llmUseDirectConfig) {
      const llmConfig = createTempLlmConfig(batchOptions);
      batchOptions.llmConfig = llmConfig.configPath;
      batchOptions.llmProfile = llmConfig.profileName;
    }
    streamProcess(req, res, process.execPath, buildBatchArgs(batchOptions), root);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ArkTaint Bridge] listening on http://localhost:${PORT}`);
  console.log(`[ArkTaint Bridge] default root: ${DEFAULT_ARKTAINT_ROOT}`);
});
