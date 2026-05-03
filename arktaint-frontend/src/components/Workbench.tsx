import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  Layers3,
  PanelRightOpen,
  Play,
  Plug,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
  Workflow,
} from 'lucide-react';

type TaskMode = 'single' | 'auto' | 'batch' | 'inspect';
type LogType = 'log' | 'error' | 'sys' | 'done';
type WorkbenchSection = 'mode' | 'scope' | 'strategy' | 'extensions' | 'batch' | 'inspect';
type InspectionMode =
  | 'none'
  | 'listModules'
  | 'listModels'
  | 'explainModule'
  | 'traceModule'
  | 'listPlugins'
  | 'explainPlugin'
  | 'tracePlugin';

type BridgeEvent = { type?: LogType; message?: string; time?: string; code?: number | null };
type BridgeConfig = { defaultArkTaintRoot?: string; valid?: boolean; reason?: string; bridgePort?: number };
type RootValidation = { ok: boolean; reason: string; root?: string };
type LogEntry = { message: string; time: string; type: LogType };
type ArtifactItem = { label: string; path: string };
type RunSnapshot = {
  phase: string;
  exitCode?: number | null;
  artifacts: ArtifactItem[];
  selectedProjects?: number;
  currentProjectIndex?: number;
  currentProjectTotal?: number;
  currentProjectName?: string;
};

const bridgeBaseUrl = import.meta.env.VITE_ARKTAINT_BRIDGE_URL || 'http://localhost:3001';
const storageKey = 'arktaint.console.settings.v7';

const modeCards: Array<{
  id: TaskMode;
  title: string;
  body: string;
  icon: typeof Play;
}> = [
  {
    id: 'single',
    title: '单项目分析',
    body: '验证一个项目能否完整跑通，并观察 UDE、规则与结果产物。',
    icon: Play,
  },
  {
    id: 'auto',
    title: '自动建模',
    body: '在结构分析之外启用 SemanticFlow，补足未知 API 和项目语义。',
    icon: Sparkles,
  },
  {
    id: 'batch',
    title: '批量任务',
    body: '面向真实项目集合，统一设置超时、分片、并发和结果回写。',
    icon: Workflow,
  },
  {
    id: 'inspect',
    title: '检查与说明',
    body: '列出、解释或追踪模块、模型与插件，不直接进入完整分析。',
    icon: Search,
  },
];

const inspectionOptions: Array<{
  value: InspectionMode;
  label: string;
  needsTarget?: boolean;
}> = [
  { value: 'none', label: '不启用检查模式' },
  { value: 'listModules', label: '列出模块' },
  { value: 'listModels', label: '列出模型' },
  { value: 'explainModule', label: '解释模块', needsTarget: true },
  { value: 'traceModule', label: '追踪模块', needsTarget: true },
  { value: 'listPlugins', label: '列出插件' },
  { value: 'explainPlugin', label: '解释插件', needsTarget: true },
  { value: 'tracePlugin', label: '追踪插件', needsTarget: true },
];

const flowPhases = [
  { key: 'scope', title: '选择范围', hint: '确定项目、源码目录和输出位置。' },
  { key: 'graph', title: '场景构建', hint: '入口恢复、PAG 构建和 UDE 审计。' },
  { key: 'model', title: '规则与建模', hint: '按需引入规则包、模型包和 SemanticFlow。' },
  { key: 'result', title: '求解与产物', hint: '输出 summary、diagnostics 和路径级差分。' },
];

function nowText() {
  return new Date().toLocaleTimeString();
}

function toLog(message: string, type: LogType = 'log', time?: string): LogEntry {
  return { message, type, time: time || nowText() };
}

function readSaved(): Record<string, string | boolean | undefined> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function cleanLines(value: string) {
  return value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

function getLogClass(log: LogEntry) {
  const text = log.message.toLowerCase();
  if (log.type === 'error' || text.includes('error') || text.includes('fail') || text.includes('timeout')) {
    return 'log-error';
  }
  if (text.includes('warn') || text.includes('need-human-check') || text.includes('partial')) {
    return 'log-warn';
  }
  if (log.type === 'done' || text.includes('summary_json') || text.includes('final_summary_json') || text.includes('complete')) {
    return 'log-success';
  }
  return 'log-info';
}

function inferPhase(message: string) {
  const text = message.toLowerCase();
  if (text.includes('summary_json') || text.includes('result_json') || text.includes('final_summary')) return '求解与结果';
  if (text.includes('semanticflow') || text.includes('llm') || text.includes('auto_model')) return '规则与建模';
  if (text.includes('build_scene') || text.includes('pag') || text.includes('executionhandoffaudit') || text.includes('stageprofile')) return '场景构建';
  return '选择范围';
}

function parseArtifact(message: string): ArtifactItem | null {
  const candidates = [
    { marker: 'summary_json=', label: 'Summary JSON' },
    { marker: 'final_summary_json=', label: '最终 Summary JSON' },
    { marker: 'summary_md=', label: 'Summary Markdown' },
    { marker: 'result_json=', label: '对照结果 JSON' },
    { marker: 'output_dir=', label: '输出目录' },
    { marker: 'session=', label: 'SemanticFlow Session' },
  ];
  for (const item of candidates) {
    const index = message.indexOf(item.marker);
    if (index >= 0) {
      const path = message.slice(index + item.marker.length).trim();
      return path ? { label: item.label, path } : null;
    }
  }
  return null;
}

function countLogs(logs: LogEntry[], type: LogType) {
  return logs.filter(item => item.type === type).length;
}

function ToggleLine({
  checked,
  onChange,
  title,
  desc,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-line ${disabled ? 'disabled' : ''}`}>
      <div>
        <strong>{title}</strong>
        <span>{desc}</span>
      </div>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

function Disclosure({
  title,
  hint,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`console-panel disclosure ${open ? 'open' : ''}`}>
      <button type="button" className="disclosure-head" onClick={onToggle}>
        <div className="disclosure-copy">
          <span className="icon-badge">{icon}</span>
          <div>
            <strong>{title}</strong>
            <p>{hint}</p>
          </div>
        </div>
        <ChevronDown size={16} />
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </section>
  );
}

function Field({
  label,
  children,
  wide = false,
  note,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  note?: string;
}) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {note ? <small>{note}</small> : null}
    </label>
  );
}

export default function Workbench() {
  const saved = useMemo(() => readSaved(), []);
  const readText = (key: string, fallback = '') => (typeof saved[key] === 'string' ? String(saved[key]) : fallback);
  const readBool = (key: string, fallback: boolean) => (typeof saved[key] === 'boolean' ? Boolean(saved[key]) : fallback);

  const [taskMode, setTaskMode] = useState<TaskMode>((readText('taskMode', 'single') as TaskMode) || 'single');
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const [rootValidation, setRootValidation] = useState<RootValidation | null>(null);
  const [validatingRoot, setValidatingRoot] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot>({ phase: '尚未开始', artifacts: [] });

  const [arktaintRoot, setArktaintRoot] = useState(readText('arktaintRoot'));
  const [repo, setRepo] = useState(readText('repo'));
  const [sourceDir, setSourceDir] = useState(readText('sourceDir'));
  const [outputDir, setOutputDir] = useState(readText('outputDir'));
  const [projectRoot, setProjectRoot] = useState(readText('projectRoot', 'D:\\cursor\\workplace\\project'));
  const [projects, setProjects] = useState(readText('projects'));

  const [profile, setProfile] = useState(readText('profile', 'default'));
  const [executionHandoff, setExecutionHandoff] = useState(readText('executionHandoff', 'enabled'));
  const [reportMode, setReportMode] = useState(readText('reportMode', 'light'));
  const [entryModel, setEntryModel] = useState(readText('entryModel', 'arkMain'));
  const [maxEntries, setMaxEntries] = useState(readText('maxEntries', '9999'));
  const [k, setK] = useState(readText('k'));
  const [incremental, setIncremental] = useState(readBool('incremental', false));
  const [incrementalCache, setIncrementalCache] = useState(readText('incrementalCache'));
  const [stopOnFirstFlow, setStopOnFirstFlow] = useState(readBool('stopOnFirstFlow', false));
  const [maxFlowsPerEntry, setMaxFlowsPerEntry] = useState(readText('maxFlowsPerEntry'));
  const [secondarySinkSweep, setSecondarySinkSweep] = useState(readText('secondarySinkSweep', 'auto'));
  const [concurrency, setConcurrency] = useState(readText('concurrency', '1'));

  const [autoModel, setAutoModel] = useState(readBool('autoModel', false));
  const [llmConfig, setLlmConfig] = useState(readText('llmConfig'));
  const [llmProfile, setLlmProfile] = useState(readText('llmProfile', 'qwen'));
  const [llmModel, setLlmModel] = useState(readText('llmModel', 'qwen3-coder-next'));
  const [llmTimeoutMs, setLlmTimeoutMs] = useState(readText('llmTimeoutMs', '45000'));
  const [llmConnectTimeoutMs, setLlmConnectTimeoutMs] = useState(readText('llmConnectTimeoutMs'));
  const [llmMaxAttempts, setLlmMaxAttempts] = useState(readText('llmMaxAttempts', '1'));
  const [llmMaxFailures, setLlmMaxFailures] = useState(readText('llmMaxFailures', '3'));
  const [llmRepairAttempts, setLlmRepairAttempts] = useState(readText('llmRepairAttempts', '0'));
  const [maxLlmItems, setMaxLlmItems] = useState(readText('maxLlmItems', '4'));
  const [arkMainMaxCandidates, setArkMainMaxCandidates] = useState(readText('arkMainMaxCandidates'));
  const [llmSessionCacheDir, setLlmSessionCacheDir] = useState(readText('llmSessionCacheDir'));
  const [llmSessionCacheMode, setLlmSessionCacheMode] = useState(readText('llmSessionCacheMode', 'rw'));
  const [publishModel, setPublishModel] = useState(readText('publishModel'));

  const [projectTimeoutSeconds, setProjectTimeoutSeconds] = useState(readText('projectTimeoutSeconds', '180'));
  const [heartbeatSeconds, setHeartbeatSeconds] = useState(readText('heartbeatSeconds', '30'));
  const [sourceDirMode, setSourceDirMode] = useState(readText('sourceDirMode', 'auto'));
  const [splitSourceDirThreshold, setSplitSourceDirThreshold] = useState(readText('splitSourceDirThreshold', '24'));
  const [sourceDirTimeoutSeconds, setSourceDirTimeoutSeconds] = useState(readText('sourceDirTimeoutSeconds', '90'));
  const [maxSplitSourceDirs, setMaxSplitSourceDirs] = useState(readText('maxSplitSourceDirs', '0'));
  const [maxProjects, setMaxProjects] = useState(readText('maxProjects'));
  const [skipExisting, setSkipExisting] = useState(readBool('skipExisting', true));

  const [kernelRule, setKernelRule] = useState(readText('kernelRule'));
  const [projectRule, setProjectRule] = useState(readText('projectRule'));
  const [candidateRule, setCandidateRule] = useState(readText('candidateRule'));
  const [modelRoot, setModelRoot] = useState(readText('modelRoot'));
  const [enableModel, setEnableModel] = useState(readText('enableModel'));
  const [disableModel, setDisableModel] = useState(readText('disableModel'));
  const [moduleSpec, setModuleSpec] = useState(readText('moduleSpec'));
  const [disableModule, setDisableModule] = useState(readText('disableModule'));
  const [arkmainSpec, setArkmainSpec] = useState(readText('arkmainSpec'));

  const [plugins, setPlugins] = useState(readText('plugins'));
  const [disablePlugins, setDisablePlugins] = useState(readText('disablePlugins'));
  const [pluginIsolate, setPluginIsolate] = useState(readText('pluginIsolate'));
  const [pluginDryRun, setPluginDryRun] = useState(readBool('pluginDryRun', false));
  const [pluginAudit, setPluginAudit] = useState(readBool('pluginAudit', false));
  const [inspectionMode, setInspectionMode] = useState<InspectionMode>((readText('inspectionMode', 'none') as InspectionMode) || 'none');
  const [inspectionTarget, setInspectionTarget] = useState(readText('inspectionTarget'));

  const [rulesOpen, setRulesOpen] = useState(readBool('rulesOpen', false));
  const [pluginsOpen, setPluginsOpen] = useState(readBool('pluginsOpen', false));
  const [semanticOpen, setSemanticOpen] = useState(readBool('semanticOpen', false));
  const [batchOpen, setBatchOpen] = useState(readBool('batchOpen', false));
  const [activeSection, setActiveSection] = useState<WorkbenchSection>('mode');

  const inspectionNeedsTarget = inspectionOptions.find(item => item.value === inspectionMode)?.needsTarget ?? false;
  const needsRepo = taskMode !== 'batch';
  const activeRootValidation = arktaintRoot.trim() ? rootValidation : null;
  const rootIsUsable = Boolean(arktaintRoot.trim()) && activeRootValidation?.ok !== false;
  const canRun =
    rootIsUsable &&
    !analyzing &&
    (needsRepo ? Boolean(repo.trim()) : Boolean(projectRoot.trim())) &&
    (taskMode !== 'inspect' || (inspectionMode !== 'none' && (!inspectionNeedsTarget || Boolean(inspectionTarget.trim()))));

  const sectionItems = useMemo(() => {
    const items: Array<{ id: WorkbenchSection; title: string; detail: string }> = [
      { id: 'mode', title: '任务模式', detail: '先确定这一轮任务属于完整分析、自动建模、批量运行还是检查说明。' },
      { id: 'scope', title: '项目与输出', detail: '确定 ArkTaint 根目录、目标项目、源码目录和输出位置。' },
      { id: 'strategy', title: '分析策略', detail: '决定 UDE、报告粒度、入口模式和搜索边界。' },
      { id: 'extensions', title: '扩展能力', detail: '按需启用自动建模、规则、模型与插件。' },
    ];
    if (taskMode === 'batch') {
      items.push({ id: 'batch', title: '批量控制', detail: '统一设置超时、分片、并发和结果回写策略。' });
    }
    if (taskMode === 'inspect') {
      items.push({ id: 'inspect', title: '检查模式', detail: '列出、解释或追踪指定模块、模型与插件。' });
    }
    return items;
  }, [taskMode]);

  const payload = useMemo(
    () => ({
      taskMode,
      arktaintRoot,
      repo,
      sourceDir,
      outputDir,
      projectRoot,
      projects,
      profile,
      executionHandoff,
      reportMode,
      entryModel,
      maxEntries,
      k,
      incremental,
      incrementalCache,
      stopOnFirstFlow,
      maxFlowsPerEntry,
      secondarySinkSweep: secondarySinkSweep === 'auto' ? undefined : secondarySinkSweep === 'true',
      autoModel: taskMode === 'inspect' ? false : autoModel,
      llmConfig,
      llmProfile,
      llmModel,
      llmTimeoutMs,
      llmConnectTimeoutMs,
      llmMaxAttempts,
      llmMaxFailures,
      llmRepairAttempts,
      maxLlmItems,
      concurrency,
      arkMainMaxCandidates,
      llmSessionCacheDir,
      llmSessionCacheMode,
      publishModel,
      projectTimeoutSeconds,
      heartbeatSeconds,
      sourceDirMode,
      splitSourceDirThreshold,
      sourceDirTimeoutSeconds,
      maxSplitSourceDirs,
      maxProjects,
      skipExisting,
      kernelRule,
      projectRule,
      candidateRule,
      modelRoot,
      enableModel,
      disableModel,
      moduleSpec,
      disableModule,
      arkmainSpec,
      plugins,
      disablePlugins,
      pluginIsolate,
      pluginDryRun,
      pluginAudit,
      inspectionMode: taskMode === 'inspect' ? inspectionMode : 'none',
      inspectionTarget: taskMode === 'inspect' ? inspectionTarget : '',
      rulesOpen,
      pluginsOpen,
      semanticOpen,
      batchOpen,
    }),
    [
      taskMode,
      arktaintRoot,
      repo,
      sourceDir,
      outputDir,
      projectRoot,
      projects,
      profile,
      executionHandoff,
      reportMode,
      entryModel,
      maxEntries,
      k,
      incremental,
      incrementalCache,
      stopOnFirstFlow,
      maxFlowsPerEntry,
      secondarySinkSweep,
      autoModel,
      llmConfig,
      llmProfile,
      llmModel,
      llmTimeoutMs,
      llmConnectTimeoutMs,
      llmMaxAttempts,
      llmMaxFailures,
      llmRepairAttempts,
      maxLlmItems,
      concurrency,
      arkMainMaxCandidates,
      llmSessionCacheDir,
      llmSessionCacheMode,
      publishModel,
      projectTimeoutSeconds,
      heartbeatSeconds,
      sourceDirMode,
      splitSourceDirThreshold,
      sourceDirTimeoutSeconds,
      maxSplitSourceDirs,
      maxProjects,
      skipExisting,
      kernelRule,
      projectRule,
      candidateRule,
      modelRoot,
      enableModel,
      disableModel,
      moduleSpec,
      disableModule,
      arkmainSpec,
      plugins,
      disablePlugins,
      pluginIsolate,
      pluginDryRun,
      pluginAudit,
      inspectionMode,
      inspectionTarget,
      rulesOpen,
      pluginsOpen,
      semanticOpen,
      batchOpen,
    ]
  );

  useEffect(() => {
    fetch(`${bridgeBaseUrl}/api/config`)
      .then(response => {
        if (!response.ok) throw new Error('bridge unavailable');
        return response.json();
      })
      .then((config: BridgeConfig) => {
        setBridgeConfig(config);
        setBridgeError('');
        setArktaintRoot(prev => prev || config.defaultArkTaintRoot || '');
      })
      .catch(() => setBridgeError('本地服务未连接。请先在 arktaint-frontend 目录运行 node server.js。'));
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [payload]);

  useEffect(() => {
    const target = arktaintRoot.trim();
    if (!target) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setValidatingRoot(true);
        const response = await fetch(`${bridgeBaseUrl}/api/validate-root?path=${encodeURIComponent(target)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('无法校验根目录');
        const data = (await response.json()) as RootValidation;
        setRootValidation(data);
      } catch {
        if (!controller.signal.aborted) {
          setRootValidation({ ok: false, reason: '无法校验 ArkTaint 根目录' });
        }
      } finally {
        if (!controller.signal.aborted) {
          setValidatingRoot(false);
        }
      }
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [arktaintRoot]);

  const handlePickFolder = async (setter: (value: string) => void) => {
    try {
      const response = await fetch(`${bridgeBaseUrl}/api/pick-folder`);
      if (!response.ok) throw new Error('目录选择失败');
      const data = await response.json();
      if (data.path) setter(data.path);
    } catch {
      setBridgeError('目录选择不可用。请确认本地服务已经启动。');
    }
  };

  const pushArtifact = (artifact: ArtifactItem) => {
    setRunSnapshot(prev => {
      if (prev.artifacts.some(item => item.label === artifact.label && item.path === artifact.path)) {
        return prev;
      }
      return { ...prev, artifacts: [...prev.artifacts, artifact] };
    });
  };

  const appendLog = (message: string, type: LogType = 'log', time?: string) => {
    setLogs(prev => [...prev, toLog(message, type, time)]);
    setRunSnapshot(prev => {
      const next: RunSnapshot = { ...prev, phase: inferPhase(message) };
      const selected = message.match(/selected_projects=(\d+)/i);
      if (selected) next.selectedProjects = Number(selected[1]);
      const progress = message.match(/\[(\d+)\/(\d+)\]\s+project=([^\s]+)/i);
      if (progress) {
        next.currentProjectIndex = Number(progress[1]);
        next.currentProjectTotal = Number(progress[2]);
        next.currentProjectName = progress[3];
      }
      return next;
    });
    const artifact = parseArtifact(message);
    if (artifact) pushArtifact(artifact);
  };

  const applyPreset = (mode: TaskMode) => {
    setTaskMode(mode);
    if (mode === 'single') {
      setAutoModel(false);
      setInspectionMode('none');
      setReportMode('light');
      setEntryModel('arkMain');
      setExecutionHandoff('enabled');
    }
    if (mode === 'auto') {
      setAutoModel(true);
      setInspectionMode('none');
      setReportMode('light');
      setEntryModel('arkMain');
      setExecutionHandoff('enabled');
      setLlmProfile(llmProfile || 'qwen');
      setLlmModel(llmModel || 'qwen3-coder-next');
    }
    if (mode === 'batch') {
      setInspectionMode('none');
      setEntryModel('explicit');
      setExecutionHandoff('enabled');
      setBatchOpen(true);
    }
    if (mode === 'inspect') {
      setAutoModel(false);
      setInspectionMode(inspectionMode === 'none' ? 'listModules' : inspectionMode);
      setReportMode('light');
      setExecutionHandoff('enabled');
    }
  };

  const startRun = async () => {
    if (!canRun) return;

    setAnalyzing(true);
    setLogs([
      toLog(`连接本地服务：${bridgeBaseUrl}`, 'sys'),
      toLog(needsRepo ? `目标项目：${repo.trim()}` : `项目集合：${projectRoot.trim()}`, 'sys'),
    ]);
    setRunSnapshot({ phase: '选择范围', artifacts: [] });

    const endpoint = taskMode === 'batch' ? '/api/batch-analyze' : '/api/analyze';
    const body =
      taskMode === 'batch'
        ? {
            ...payload,
            arktaintRoot: arktaintRoot.trim(),
            projectRoot: projectRoot.trim(),
          }
        : {
            ...payload,
            arktaintRoot: arktaintRoot.trim(),
            repo: repo.trim(),
          };

    try {
      const response = await fetch(`${bridgeBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error('本地服务没有返回实时输出。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventText of events) {
          const dataLine = eventText.split('\n').find(line => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine.slice(6)) as BridgeEvent;
            if (data.type === 'done') {
              setAnalyzing(false);
              setRunSnapshot(prev => ({ ...prev, phase: '求解与结果', exitCode: data.code }));
              setLogs(prev => [...prev, toLog(`引擎执行结束，退出码：${data.code ?? 'unknown'}`, 'done', data.time)]);
            } else if (data.message) {
              appendLog(data.message, data.type || 'log', data.time);
            }
          } catch (error) {
            appendLog(`无法解析运行事件：${String(error)}`, 'error');
          }
        }
      }
    } catch (error) {
      appendLog(`本地服务通信失败：${String(error)}`, 'error');
      setAnalyzing(false);
      setRunSnapshot(prev => ({ ...prev, exitCode: -1 }));
    }
  };

  const intentSummary = [
    taskMode === 'batch' ? '批量任务' : taskMode === 'inspect' ? '检查与说明' : taskMode === 'auto' ? '自动建模' : '单项目分析',
    executionHandoff === 'enabled' ? '启用 UDE' : '关闭 UDE',
    autoModel ? '启用自动建模' : '不启用自动建模',
    `报告模式：${reportMode}`,
    `入口模型：${entryModel}`,
  ];

  const projectSummary =
    taskMode === 'batch'
      ? cleanLines(projects).length > 0
        ? `${cleanLines(projects).length} 个指定项目`
        : '自动扫描项目集合目录'
      : cleanLines(sourceDir).length > 0
        ? `${cleanLines(sourceDir).length} 个手动源码目录`
        : '自动发现源码目录';

  const sectionStatus: Record<WorkbenchSection, 'ready' | 'required' | 'optional'> = {
    mode: taskMode ? 'ready' : 'required',
    scope: rootIsUsable && (needsRepo ? Boolean(repo.trim()) : Boolean(projectRoot.trim())) ? 'ready' : 'required',
    strategy: executionHandoff && reportMode && entryModel ? 'ready' : 'required',
    extensions: autoModel || Boolean(modelRoot.trim()) || Boolean(enableModel.trim()) || Boolean(kernelRule.trim()) || Boolean(plugins.trim()) ? 'ready' : 'optional',
    batch:
      taskMode === 'batch'
        ? projectTimeoutSeconds && heartbeatSeconds && sourceDirMode
          ? 'ready'
          : 'required'
        : 'optional',
    inspect:
      taskMode === 'inspect'
        ? inspectionMode !== 'none' && (!inspectionNeedsTarget || Boolean(inspectionTarget.trim()))
          ? 'ready'
          : 'required'
        : 'optional',
  };

  const resolvedSection = sectionItems.some(item => item.id === activeSection) ? activeSection : (sectionItems[0]?.id ?? 'mode');
  const currentSectionIndex = sectionItems.findIndex(item => item.id === resolvedSection);
  const prevSection = currentSectionIndex > 0 ? sectionItems[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex >= 0 && currentSectionIndex < sectionItems.length - 1 ? sectionItems[currentSectionIndex + 1] : null;
  const sectionHeader = sectionItems.find(item => item.id === resolvedSection);

  const statusLabel = (status: 'ready' | 'required' | 'optional') =>
    status === 'ready' ? '已就绪' : status === 'required' ? '待完成' : '可选';

  const statusClass = (status: 'ready' | 'required' | 'optional') =>
    status === 'ready' ? 'ok' : status === 'required' ? 'warn' : 'muted';

  const renderSectionBody = () => {
    if (resolvedSection === 'mode') {
      return (
        <section className="console-panel workspace-panel">
          <div className="panel-heading">
            <span className="icon-badge"><PanelRightOpen size={16} /></span>
            <div>
              <strong>先确定这一次要做什么</strong>
              <p>模式决定页面后续会显示哪些设置，也决定分析是面向单项目、自动建模、批量任务还是检查说明。</p>
            </div>
          </div>
          <div className="mode-grid refined-mode-grid">
            {modeCards.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mode-card ${taskMode === item.id ? 'active' : ''}`}
                  onClick={() => applyPreset(item.id)}
                >
                  <span className="mode-card-icon"><Icon size={18} /></span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (resolvedSection === 'scope') {
      return (
        <section className="console-panel workspace-panel">
          <div className="panel-heading">
            <span className="icon-badge"><FolderOpen size={16} /></span>
            <div>
              <strong>确定项目范围与输出位置</strong>
              <p>先把 ArkTaint 根目录、目标项目和输出位置说明清楚，后续的所有分析策略才有实际作用对象。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="ArkTaint 根目录" wide>
              <div className="path-row">
                <input value={arktaintRoot} onChange={event => setArktaintRoot(event.target.value)} placeholder="D:\\cursor\\workplace\\ArkTaint" />
                <button className="secondary-button" type="button" onClick={() => handlePickFolder(setArktaintRoot)}>
                  选择
                </button>
              </div>
              <div className={`validation-note ${validatingRoot ? 'pending' : activeRootValidation?.ok ? 'ok' : activeRootValidation ? 'error' : 'idle'}`}>
                {validatingRoot
                  ? '正在校验 package.json 中的 analyze 脚本。'
                  : activeRootValidation?.ok
                    ? 'ArkTaint 根目录有效，可以直接运行。'
                    : activeRootValidation?.reason || '填入目录后会自动校验。'}
              </div>
            </Field>

            {taskMode === 'batch' ? (
              <>
                <Field label="项目集合目录" wide>
                  <div className="path-row">
                    <input value={projectRoot} onChange={event => setProjectRoot(event.target.value)} placeholder="D:\\cursor\\workplace\\project" />
                    <button className="secondary-button" type="button" onClick={() => handlePickFolder(setProjectRoot)}>
                      选择
                    </button>
                  </div>
                </Field>
                <Field label="指定项目（可选）" wide note="可按行或按逗号填写项目名；留空时自动扫描项目集合目录。">
                  <textarea value={projects} onChange={event => setProjects(event.target.value)} placeholder="例如：HarmonyStudy, JhHarmonyDemo" />
                </Field>
              </>
            ) : (
              <>
                <Field label="目标项目目录" wide>
                  <div className="path-row">
                    <input value={repo} onChange={event => setRepo(event.target.value)} placeholder="D:\\cursor\\workplace\\project\\HarmonyStudy" />
                    <button className="secondary-button" type="button" onClick={() => handlePickFolder(setRepo)}>
                      选择
                    </button>
                  </div>
                </Field>
                <Field label="源码目录（可选）" wide note="通常可以留空并自动发现；只有需要限制分析范围时才手动填写。">
                  <textarea value={sourceDir} onChange={event => setSourceDir(event.target.value)} placeholder="例如：entry/src/main/ets" />
                </Field>
              </>
            )}

            <Field label="输出目录（可选）" wide>
              <div className="path-row">
                <input value={outputDir} onChange={event => setOutputDir(event.target.value)} placeholder="留空时使用 ArkTaint 默认输出目录" />
                <button className="secondary-button" type="button" onClick={() => handlePickFolder(setOutputDir)}>
                  选择
                </button>
              </div>
            </Field>
          </div>
        </section>
      );
    }

    if (resolvedSection === 'strategy') {
      return (
        <section className="console-panel workspace-panel">
          <div className="panel-heading">
            <span className="icon-badge"><Settings2 size={16} /></span>
            <div>
              <strong>决定这一轮分析的求解边界</strong>
              <p>这里控制 UDE、报告粒度、入口模式和搜索范围，是整轮分析最核心的一组参数。</p>
            </div>
          </div>
          <div className="form-grid compact-grid">
            <Field label="分析档位">
              <select value={profile} onChange={event => setProfile(event.target.value)}>
                <option value="default">标准</option>
                <option value="fast">快速</option>
                <option value="strict">严格</option>
              </select>
            </Field>
            <Field label="报告模式">
              <select value={reportMode} onChange={event => setReportMode(event.target.value)}>
                <option value="light">轻量</option>
                <option value="full">完整</option>
              </select>
            </Field>
            <Field label="入口模型">
              <select value={entryModel} onChange={event => setEntryModel(event.target.value)}>
                <option value="arkMain">ArkMain</option>
                <option value="explicit">显式入口</option>
              </select>
            </Field>
            <Field label="统一延后执行恢复（UDE）">
              <select value={executionHandoff} onChange={event => setExecutionHandoff(event.target.value)} disabled={taskMode === 'batch'}>
                <option value="enabled">启用</option>
                <option value="disabled">关闭</option>
              </select>
            </Field>
          </div>

          <div className="form-grid compact-grid">
            <Field label="最大入口数">
              <input value={maxEntries} onChange={event => setMaxEntries(event.target.value)} placeholder="9999" />
            </Field>
            <Field label="上下文深度 k">
              <input
                value={k}
                onChange={event => setK(event.target.value)}
                placeholder={taskMode === 'batch' ? '批量模式当前不生效' : '留空时使用默认值'}
                disabled={taskMode === 'batch'}
              />
            </Field>
            <Field label="每入口最大流数">
              <input value={maxFlowsPerEntry} onChange={event => setMaxFlowsPerEntry(event.target.value)} placeholder="留空时不限制" />
            </Field>
            <Field label="二次汇点扫描">
              <select value={secondarySinkSweep} onChange={event => setSecondarySinkSweep(event.target.value)}>
                <option value="auto">按默认策略</option>
                <option value="true">启用</option>
                <option value="false">关闭</option>
              </select>
            </Field>
            <Field label="分析并发">
              <input value={concurrency} onChange={event => setConcurrency(event.target.value)} placeholder="1" />
            </Field>
          </div>

          <div className="toggle-grid">
            <ToggleLine checked={incremental} onChange={setIncremental} title="增量缓存" desc="保留增量分析结果，适合重复对照同一项目。" />
            <ToggleLine checked={stopOnFirstFlow} onChange={setStopOnFirstFlow} title="首条流即停" desc="用于快速验证路径是否存在，不适合完整统计。" />
          </div>

          <Field label="增量缓存目录（可选）" wide>
            <input value={incrementalCache} onChange={event => setIncrementalCache(event.target.value)} placeholder="留空时使用默认缓存目录" />
          </Field>
        </section>
      );
    }

    if (resolvedSection === 'extensions') {
      return (
        <div className="workspace-stack">
          <Disclosure
            title="自动建模与 SemanticFlow"
            hint="当项目需要补足未知 API 或额外语义时，再启用自动建模和 LLM 相关设置。"
            icon={<Bot size={16} />}
            open={semanticOpen}
            onToggle={() => setSemanticOpen(prev => !prev)}
          >
            <div className="toggle-grid">
              <ToggleLine
                checked={autoModel}
                onChange={setAutoModel}
                title="启用自动建模"
                desc="把未知 API 候选交给 SemanticFlow，自动生成可复用产物。"
                disabled={taskMode === 'inspect'}
              />
            </div>
            <div className="form-grid">
              <Field label="LLM 配置名">
                <input value={llmProfile} onChange={event => setLlmProfile(event.target.value)} placeholder="qwen" />
              </Field>
              <Field label="模型覆盖">
                <input value={llmModel} onChange={event => setLlmModel(event.target.value)} placeholder="qwen3-coder-next" />
              </Field>
              <Field label="语义配置文件">
                <input value={llmConfig} onChange={event => setLlmConfig(event.target.value)} placeholder="可选：覆盖当前配置模板" />
              </Field>
              <Field label="单次请求超时 ms">
                <input value={llmTimeoutMs} onChange={event => setLlmTimeoutMs(event.target.value)} />
              </Field>
              <Field label="连接超时 ms">
                <input value={llmConnectTimeoutMs} onChange={event => setLlmConnectTimeoutMs(event.target.value)} placeholder="留空时使用默认值" />
              </Field>
              <Field label="每目录最大 LLM 项数">
                <input value={maxLlmItems} onChange={event => setMaxLlmItems(event.target.value)} />
              </Field>
              <Field label="ArkMain 候选上限">
                <input value={arkMainMaxCandidates} onChange={event => setArkMainMaxCandidates(event.target.value)} placeholder="留空时使用默认值" />
              </Field>
              <Field label="单项重试次数">
                <input value={llmMaxAttempts} onChange={event => setLlmMaxAttempts(event.target.value)} />
              </Field>
              <Field label="连续失败阈值">
                <input value={llmMaxFailures} onChange={event => setLlmMaxFailures(event.target.value)} />
              </Field>
              <Field label="修复尝试次数">
                <input value={llmRepairAttempts} onChange={event => setLlmRepairAttempts(event.target.value)} />
              </Field>
              <Field label="会话缓存模式">
                <select value={llmSessionCacheMode} onChange={event => setLlmSessionCacheMode(event.target.value)}>
                  <option value="rw">读写</option>
                  <option value="read">只读</option>
                  <option value="write">只写</option>
                  <option value="off">关闭</option>
                </select>
              </Field>
              <Field label="发布模型包 ID（可选）" wide>
                <input value={publishModel} onChange={event => setPublishModel(event.target.value)} placeholder="自动建模完成后发布到指定模型包 ID" />
              </Field>
              <Field label="会话缓存目录" wide>
                <input value={llmSessionCacheDir} onChange={event => setLlmSessionCacheDir(event.target.value)} placeholder="可选：固定 LLM 会话缓存目录" />
              </Field>
            </div>
          </Disclosure>

          <Disclosure
            title="规则、模型与模块"
            hint="补充规则包、模型包、模块约束和 ArkMain 约束，细化项目的分析语义。"
            icon={<Layers3 size={16} />}
            open={rulesOpen}
            onToggle={() => setRulesOpen(prev => !prev)}
          >
            <div className="form-grid">
              <Field label="内核规则">
                <input value={kernelRule} onChange={event => setKernelRule(event.target.value)} />
              </Field>
              <Field label="项目规则">
                <input value={projectRule} onChange={event => setProjectRule(event.target.value)} />
              </Field>
              <Field label="候选规则">
                <input value={candidateRule} onChange={event => setCandidateRule(event.target.value)} />
              </Field>
              <Field label="模型根目录" wide note="可按行填写多个 model root。">
                <textarea value={modelRoot} onChange={event => setModelRoot(event.target.value)} />
              </Field>
              <Field label="启用模型">
                <input value={enableModel} onChange={event => setEnableModel(event.target.value)} placeholder="按行或逗号填写模型包 ID" />
              </Field>
              <Field label="禁用模型">
                <input value={disableModel} onChange={event => setDisableModel(event.target.value)} placeholder="按行或逗号填写模型包 ID" />
              </Field>
              <Field label="模块约束文件" wide>
                <textarea value={moduleSpec} onChange={event => setModuleSpec(event.target.value)} />
              </Field>
              <Field label="禁用模块">
                <input value={disableModule} onChange={event => setDisableModule(event.target.value)} placeholder="按行或逗号填写模块 ID" />
              </Field>
              <Field label="ArkMain 约束文件" wide>
                <textarea value={arkmainSpec} onChange={event => setArkmainSpec(event.target.value)} />
              </Field>
            </div>
          </Disclosure>

          <Disclosure
            title="插件与检查模式"
            hint="按需启用插件，或列出、解释和追踪已有扩展能力。"
            icon={<Plug size={16} />}
            open={pluginsOpen}
            onToggle={() => setPluginsOpen(prev => !prev)}
          >
            <div className="form-grid">
              <Field label="插件路径">
                <input value={plugins} onChange={event => setPlugins(event.target.value)} placeholder="按行或逗号填写插件路径" />
              </Field>
              <Field label="禁用插件">
                <input value={disablePlugins} onChange={event => setDisablePlugins(event.target.value)} placeholder="按行或逗号填写插件名" />
              </Field>
              <Field label="隔离插件" wide>
                <textarea value={pluginIsolate} onChange={event => setPluginIsolate(event.target.value)} placeholder="需要隔离执行的插件名" />
              </Field>
              <Field label="检查模式">
                <select value={inspectionMode} onChange={event => setInspectionMode(event.target.value as InspectionMode)} disabled={taskMode !== 'inspect'}>
                  {inspectionOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="检查目标">
                <input
                  value={inspectionTarget}
                  onChange={event => setInspectionTarget(event.target.value)}
                  placeholder="模块 ID 或插件名"
                  disabled={taskMode !== 'inspect' || !inspectionNeedsTarget}
                />
              </Field>
            </div>
            <div className="toggle-grid">
              <ToggleLine checked={pluginDryRun} onChange={setPluginDryRun} title="插件 dry-run" desc="只验证加载和解释，不真正参与分析。" />
              <ToggleLine checked={pluginAudit} onChange={setPluginAudit} title="插件审计" desc="输出插件相关诊断，适合复核扩展能力。" />
            </div>
          </Disclosure>
        </div>
      );
    }

    if (resolvedSection === 'batch' && taskMode === 'batch') {
      return (
        <section className="console-panel workspace-panel">
          <div className="panel-heading">
            <span className="icon-badge"><Workflow size={16} /></span>
            <div>
              <strong>让批量任务可控收口</strong>
              <p>为真实项目集合统一设置超时、心跳和分片策略，保证长时间运行时也能稳定回写结果。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="最大项目数">
              <input value={maxProjects} onChange={event => setMaxProjects(event.target.value)} placeholder="留空时不限制" />
            </Field>
            <Field label="项目超时（秒）">
              <input value={projectTimeoutSeconds} onChange={event => setProjectTimeoutSeconds(event.target.value)} />
            </Field>
            <Field label="心跳间隔（秒）">
              <input value={heartbeatSeconds} onChange={event => setHeartbeatSeconds(event.target.value)} />
            </Field>
            <Field label="源码目录模式">
              <select value={sourceDirMode} onChange={event => setSourceDirMode(event.target.value)}>
                <option value="auto">自动</option>
                <option value="project">整项目</option>
                <option value="split">强制分片</option>
              </select>
            </Field>
            <Field label="分片阈值">
              <input value={splitSourceDirThreshold} onChange={event => setSplitSourceDirThreshold(event.target.value)} />
            </Field>
            <Field label="分片超时（秒）">
              <input value={sourceDirTimeoutSeconds} onChange={event => setSourceDirTimeoutSeconds(event.target.value)} />
            </Field>
            <Field label="最大分片数">
              <input value={maxSplitSourceDirs} onChange={event => setMaxSplitSourceDirs(event.target.value)} placeholder="0 表示全部" />
            </Field>
          </div>
          <div className="toggle-grid">
            <ToggleLine checked={skipExisting} onChange={setSkipExisting} title="跳过已有结果" desc="已经生成 summary 的项目不再重复跑。" />
          </div>
        </section>
      );
    }

    if (resolvedSection === 'inspect' && taskMode === 'inspect') {
      return (
        <section className="console-panel workspace-panel">
          <div className="panel-heading">
            <span className="icon-badge"><Search size={16} /></span>
            <div>
              <strong>检查已有能力，而不是直接求解</strong>
              <p>列出、解释或追踪模块、模型和插件，适合在正式分析前确认约束和扩展能力是否符合预期。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="检查模式">
              <select value={inspectionMode} onChange={event => setInspectionMode(event.target.value as InspectionMode)}>
                {inspectionOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="检查目标" note={inspectionNeedsTarget ? '当前模式需要指定模块 ID 或插件名。' : '当前模式不需要额外目标。'}>
              <input value={inspectionTarget} onChange={event => setInspectionTarget(event.target.value)} placeholder="模块 ID 或插件名" disabled={!inspectionNeedsTarget} />
            </Field>
          </div>
        </section>
      );
    }

    return null;
  };

  return (
    <div className="workbench-shell">
      <div className="workbench-heading">
        <div>
          <span className="eyebrow">分析工作台</span>
          <h2>让一次分析从选择项目开始，再逐步收敛到求解策略</h2>
          <p>左侧决定当前步骤，中间只编辑这一组设置，右侧始终显示运行状态、产物路径和日志。</p>
        </div>
        <div className={`bridge-state ${bridgeError ? 'error' : bridgeConfig?.valid ? 'ok' : 'warn'}`}>
          {bridgeError || `本地服务已连接 · 默认根目录：${bridgeConfig?.defaultArkTaintRoot || '-'}`}
        </div>
      </div>

      <div className="starter-guide">
        <strong>第一次使用：</strong>
        <span>先选任务模式，再填写项目目录。源码目录通常可以留空；确认 ArkTaint 根目录校验通过后，再开始首轮分析。</span>
      </div>

      <div className="workbench-grid workbench-grid-refined">
        <aside className="workspace-nav">
          <section className="console-panel workspace-map">
            <div className="workspace-map-head">
              <strong>操作步骤</strong>
              <span>{currentSectionIndex + 1} / {sectionItems.length}</span>
            </div>
            <div className="workspace-section-list">
              {sectionItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`workspace-section-tab ${resolvedSection === item.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="workspace-section-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="workspace-section-copy">
                    <strong>{item.title}</strong>
                    <em>{item.detail}</em>
                  </span>
                  <span className={`workspace-section-state ${statusClass(sectionStatus[item.id])}`}>
                    {statusLabel(sectionStatus[item.id])}
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </section>

          <section className="console-panel workspace-map-note">
            <div className="panel-heading">
              <span className="icon-badge"><Workflow size={16} /></span>
              <div>
                <strong>分析流程</strong>
                <p>工作台配置完成后，ArkTaint 会按固定链路推进，不需要回到前面逐项寻找按钮。</p>
              </div>
            </div>
            <div className="workbench-strip vertical">
              {flowPhases.map(item => (
                <div key={item.key} className={`strip-step ${runSnapshot.phase === item.title ? 'active' : ''}`}>
                  <strong>{item.title}</strong>
                  <span>{item.hint}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <div className="workbench-config">
          <section className="console-panel workspace-title-panel">
            <div className="workspace-section-headline">
              <div>
                <span className="eyebrow">当前步骤</span>
                <h3>{sectionHeader?.title}</h3>
                <p>{sectionHeader?.detail}</p>
              </div>
              <span className={`workspace-badge ${statusClass(sectionStatus[resolvedSection])}`}>
                {statusLabel(sectionStatus[resolvedSection])}
              </span>
            </div>
          </section>

          {renderSectionBody()}

          <div className="section-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={!prevSection}
              onClick={() => prevSection && setActiveSection(prevSection.id)}
            >
              <ArrowLeft size={15} />
              上一步
            </button>
            <button
              type="button"
              className="primary-button ghost-primary"
              disabled={!nextSection}
              onClick={() => nextSection && setActiveSection(nextSection.id)}
            >
              下一步
              <ArrowRight size={15} />
            </button>
          </div>
        </div>

        <aside className="workbench-status">
          <section className="console-panel status-panel">
            <div className="panel-heading">
              <span className="icon-badge"><CheckCircle2 size={16} /></span>
              <div>
                <strong>当前任务摘要</strong>
                <p>这里固定展示本轮分析的目标、范围和关键策略，不需要返回中间区域反复确认。</p>
              </div>
            </div>
            <div className="intent-list">
              {intentSummary.map(item => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <dl className="status-definition">
              <div>
                <dt>当前范围</dt>
                <dd>{taskMode === 'batch' ? projectRoot || '未选择' : repo || '未选择'}</dd>
              </div>
              <div>
                <dt>源码目录</dt>
                <dd>{projectSummary}</dd>
              </div>
              <div>
                <dt>SemanticFlow</dt>
                <dd>{autoModel ? `${llmProfile}/${llmModel || '当前配置默认模型'}` : '关闭'}</dd>
              </div>
              <div>
                <dt>检查模式</dt>
                <dd>{taskMode === 'inspect' ? (inspectionOptions.find(item => item.value === inspectionMode)?.label || '未选择') : '不启用检查模式'}</dd>
              </div>
            </dl>
            <button className="primary-button run-button" type="button" disabled={!canRun} onClick={startRun}>
              <Play size={16} />
              {analyzing ? '分析进行中' : taskMode === 'inspect' ? '开始检查' : '开始分析'}
            </button>
          </section>

          <section className="console-panel status-panel">
            <div className="panel-heading">
              <span className="icon-badge"><Clock3 size={16} /></span>
              <div>
                <strong>运行状态</strong>
                <p>实时显示阶段、当前项目、产物数量和退出状态，便于判断任务是否按预期推进。</p>
              </div>
            </div>
            <div className="runtime-grid">
              <div>
                <span>阶段</span>
                <strong>{runSnapshot.phase}</strong>
              </div>
              <div>
                <span>已记录产物</span>
                <strong>{runSnapshot.artifacts.length}</strong>
              </div>
              <div>
                <span>当前项目</span>
                <strong>{runSnapshot.currentProjectName || '尚未进入项目循环'}</strong>
              </div>
              <div>
                <span>退出码</span>
                <strong>{runSnapshot.exitCode ?? (analyzing ? '运行中' : '未开始')}</strong>
              </div>
            </div>
            {(runSnapshot.currentProjectTotal || runSnapshot.selectedProjects) && (
              <div className="progress-summary">
                <strong>项目进度</strong>
                <span>{runSnapshot.currentProjectIndex || 0} / {runSnapshot.currentProjectTotal || runSnapshot.selectedProjects || 0}</span>
              </div>
            )}
          </section>

          <section className="console-panel status-panel">
            <div className="panel-heading">
              <span className="icon-badge"><FileText size={16} /></span>
              <div>
                <strong>最近产物</strong>
                <p>summary、对照结果、输出目录和 SemanticFlow session 会自动汇总在这里。</p>
              </div>
            </div>
            <div className="artifact-list">
              {runSnapshot.artifacts.length === 0 ? (
                <div className="artifact-empty">
                  <strong>尚未发现产物路径</strong>
                  <span>开始运行后，这里会自动列出 summary、result 和输出目录。</span>
                </div>
              ) : (
                runSnapshot.artifacts.map(item => (
                  <article key={`${item.label}-${item.path}`} className="artifact-card">
                    <strong>{item.label}</strong>
                    <span>{item.path}</span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="console-panel terminal-panel">
            <div className="panel-heading">
              <span className="icon-badge"><SquareTerminal size={16} /></span>
              <div>
                <strong>Heartbeat 日志</strong>
                <p>实时显示引擎输出，并按信息、警告和错误重新着色，方便快速定位异常。</p>
              </div>
            </div>
            <div className="terminal-stats">
              <span><CheckCircle2 size={14} /> 完成 {countLogs(logs, 'done')}</span>
              <span><Sparkles size={14} /> 系统 {countLogs(logs, 'sys')}</span>
              <span><Search size={14} /> 日志 {countLogs(logs, 'log')}</span>
              <span><Clock3 size={14} /> 错误 {countLogs(logs, 'error')}</span>
            </div>
            <div className="terminal-feed">
              {logs.length === 0 ? (
                <div className="terminal-empty">
                  <strong>尚未开始运行</strong>
                  <span>点击“开始分析”后，这里会显示实时执行输出。</span>
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={`${log.time}-${index}`} className="terminal-line">
                    <span className="terminal-time">[{log.time}]</span>
                    <span className={getLogClass(log)}>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
