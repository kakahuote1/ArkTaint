import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  Gauge,
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
type WorkbenchScreen = 'launchpad' | 'single' | 'auto' | 'batch' | 'inspect' | 'run';
type ConfigPanel = 'scope' | 'strategy' | 'semantic' | 'batch' | 'inspect' | 'extensions' | 'launch';
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
  hint: string;
  action: string;
  icon: typeof Play;
}> = [
  {
    id: 'single',
    title: '单项目分析',
    body: '选择一个真实 ArkTS 项目，按标准链路完成预分析和全量分析。',
    hint: '新手推荐',
    action: '配置单项目',
    icon: Play,
  },
  {
    id: 'auto',
    title: 'LLM 建模分析',
    body: '在标准链路上开启 SemanticFlow，用模型补足未知 API 语义。',
    hint: '需要模型额度',
    action: '配置建模',
    icon: Sparkles,
  },
  {
    id: 'batch',
    title: '批量真实项目',
    body: '面向项目集合运行统一分析，控制超时、分片、复用和输出。',
    hint: '适合实验集',
    action: '配置批量',
    icon: Workflow,
  },
  {
    id: 'inspect',
    title: '能力检查',
    body: '列出、解释或追踪模块、模型和插件，先确认能力再进入分析。',
    hint: '排障复核',
    action: '配置检查',
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

const modelOptions = ['qwen3-coder-next', 'qwen3.5-plus-2026-02-15', 'glm-5', 'qwen3.5-27b'];

const flowPhases = [
  { key: 'scope', title: '选择范围', hint: '确认项目、源码目录和输出位置。' },
  { key: 'graph', title: '场景构建', hint: '恢复入口、构建分析图并记录审计信息。' },
  { key: 'model', title: '规则与建模', hint: '按需引入规则包、模型包和 SemanticFlow。' },
  { key: 'result', title: '求解与结果', hint: '输出 summary、diagnostics 和结果路径。' },
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

function screenForMode(mode: TaskMode): WorkbenchScreen {
  return mode;
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
      <span className="toggle-text">
        <strong>{title}</strong>
        <em>{desc}</em>
      </span>
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
    <section className={`surface-panel disclosure ${open ? 'open' : ''}`}>
      <button type="button" className="disclosure-head" onClick={onToggle}>
        <span className="icon-badge">{icon}</span>
        <span className="disclosure-title">
          <strong>{title}</strong>
          <em>{hint}</em>
        </span>
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

function ProcessRibbon({ activePhase }: { activePhase: string }) {
  return (
    <div className="process-ribbon">
      {flowPhases.map((item, index) => (
        <div key={item.key} className={`process-node ${activePhase === item.title ? 'active' : ''}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{item.title}</strong>
          <em>{item.hint}</em>
        </div>
      ))}
    </div>
  );
}

export default function Workbench() {
  const saved = useMemo(() => readSaved(), []);
  const readText = (key: string, fallback = '') => (typeof saved[key] === 'string' ? String(saved[key]) : fallback);
  const readBool = (key: string, fallback: boolean) => (typeof saved[key] === 'boolean' ? Boolean(saved[key]) : fallback);

  const [taskMode, setTaskMode] = useState<TaskMode>((readText('taskMode', 'single') as TaskMode) || 'single');
  const [screen, setScreen] = useState<WorkbenchScreen>('launchpad');
  const [viewLeaving, setViewLeaving] = useState(false);
  const [configPanel, setConfigPanel] = useState<ConfigPanel>('scope');
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

  const inspectionNeedsTarget = inspectionOptions.find(item => item.value === inspectionMode)?.needsTarget ?? false;
  const needsRepo = taskMode !== 'batch';
  const activeRootValidation = arktaintRoot.trim() ? rootValidation : null;
  const rootIsUsable = Boolean(arktaintRoot.trim()) && activeRootValidation?.ok !== false;
  const scopeReady = rootIsUsable && (needsRepo ? Boolean(repo.trim()) : Boolean(projectRoot.trim()));
  const strategyReady = Boolean(executionHandoff && reportMode && entryModel);
  const inspectReady = taskMode !== 'inspect' || (inspectionMode !== 'none' && (!inspectionNeedsTarget || Boolean(inspectionTarget.trim())));
  const canRun = rootIsUsable && !analyzing && (needsRepo ? Boolean(repo.trim()) : Boolean(projectRoot.trim())) && inspectReady;

  const navigateScreen = (next: WorkbenchScreen) => {
    if (next === screen || viewLeaving) return;
    setViewLeaving(true);
    window.setTimeout(() => {
      setScreen(next);
      setViewLeaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
  };

  const configPanels = useMemo(() => {
    const items: Array<{ id: ConfigPanel; title: string; hint: string; required?: boolean; icon: typeof FolderOpen }> = [
      { id: 'scope', title: '项目范围', hint: taskMode === 'batch' ? '选择项目集合和输出位置' : '选择待分析项目和源码范围', required: true, icon: FolderOpen },
    ];

    if (taskMode === 'auto') {
      items.push({ id: 'semantic', title: 'LLM 建模', hint: '选择模型和会话策略', required: true, icon: Bot });
      items.push({ id: 'strategy', title: '分析策略', hint: '入口、报告和搜索边界', required: true, icon: Settings2 });
    } else if (taskMode === 'batch') {
      items.push({ id: 'batch', title: '批量控制', hint: '超时、心跳和分片策略', required: true, icon: Workflow });
      items.push({ id: 'strategy', title: '分析策略', hint: '入口、报告和并发', required: true, icon: Settings2 });
      items.push({ id: 'semantic', title: 'LLM 建模', hint: '批量任务可选建模', icon: Bot });
    } else if (taskMode === 'inspect') {
      items.push({ id: 'inspect', title: '检查目标', hint: '选择要列出、解释或追踪的能力', required: true, icon: Search });
    } else {
      items.push({ id: 'strategy', title: '分析策略', hint: '默认即可运行，需要时再调整', required: true, icon: Settings2 });
    }

    items.push({ id: 'extensions', title: '扩展能力', hint: '规则、模型、模块和插件', icon: Layers3 });
    items.push({ id: 'launch', title: '启动分析', hint: '最终确认并进入运行流程', required: true, icon: CheckCircle2 });
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
      .catch(() => setBridgeError('本地桥接服务未连接。请先在 arktaint-frontend 目录运行 node server.js。'));
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
      setBridgeError('目录选择不可用。请确认本地桥接服务已经启动。');
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
    setConfigPanel('scope');
    navigateScreen(screenForMode(mode));
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
      setSemanticOpen(true);
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
      setPluginsOpen(true);
    }
  };

  const startRun = async () => {
    if (!canRun) return;

    navigateScreen('run');
    setAnalyzing(true);
    setLogs([
      toLog(`连接本地桥接服务：${bridgeBaseUrl}`, 'sys'),
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
      if (!response.body) throw new Error('本地桥接服务没有返回实时输出。');

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
      appendLog(`本地桥接通信失败：${String(error)}`, 'error');
      setAnalyzing(false);
      setRunSnapshot(prev => ({ ...prev, exitCode: -1 }));
    }
  };

  const activeMode = modeCards.find(item => item.id === taskMode) || modeCards[0];
  const ActiveModeIcon = activeMode.icon;
  const viewMotionClass = viewLeaving ? 'is-leaving' : 'is-entering';
  const resolvedConfigPanel = configPanels.some(item => item.id === configPanel) ? configPanel : 'scope';
  const activePanel = configPanels.find(item => item.id === resolvedConfigPanel) || configPanels[0];
  const activePanelIndex = Math.max(0, configPanels.findIndex(item => item.id === activePanel.id));
  const previousPanel = activePanelIndex > 0 ? configPanels[activePanelIndex - 1] : null;
  const nextPanel = activePanelIndex < configPanels.length - 1 ? configPanels[activePanelIndex + 1] : null;

  const intentSummary = [
    taskMode === 'batch' ? '批量任务' : taskMode === 'inspect' ? '能力检查' : taskMode === 'auto' ? 'LLM 建模分析' : '单项目分析',
    executionHandoff === 'enabled' ? '启用 UDE' : '关闭 UDE',
    autoModel ? '启用自动建模' : '不启用自动建模',
    `报告：${reportMode}`,
    `入口：${entryModel}`,
  ];

  const projectSummary =
    taskMode === 'batch'
      ? cleanLines(projects).length > 0
        ? `${cleanLines(projects).length} 个指定项目`
        : '自动扫描项目集合目录'
      : cleanLines(sourceDir).length > 0
        ? `${cleanLines(sourceDir).length} 个手动源码目录`
        : '自动发现源码目录';

  const statusLabel = (status: boolean, optional = false) => {
    if (status) return '已就绪';
    return optional ? '可选' : '待完成';
  };

  const renderScopePanel = () => (
    <section className="surface-panel config-panel">
      <div className="panel-heading">
        <span className="icon-badge"><FolderOpen size={16} /></span>
        <div>
          <strong>{taskMode === 'batch' ? '项目集合与输出位置' : '项目范围与输出位置'}</strong>
          <p>这里只保留运行前必须确认的目录；源码目录和输出目录可以留空，让 ArkTaint 使用默认发现与输出策略。</p>
        </div>
      </div>

      <div className="form-grid relaxed">
        <Field label="ArkTaint 根目录" wide>
          <div className="path-row">
            <input value={arktaintRoot} onChange={event => setArktaintRoot(event.target.value)} placeholder="D:\cursor\workplace\ArkTaint" />
            <button className="folder-button" type="button" onClick={() => handlePickFolder(setArktaintRoot)}>
              <FolderOpen size={15} />
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
                <input value={projectRoot} onChange={event => setProjectRoot(event.target.value)} placeholder="D:\cursor\workplace\project" />
                <button className="folder-button" type="button" onClick={() => handlePickFolder(setProjectRoot)}>
                  <FolderOpen size={15} />
                  选择
                </button>
              </div>
            </Field>
            <Field label="指定项目，可选" wide note="按行或逗号填写项目名；留空时自动扫描项目集合目录。">
              <textarea value={projects} onChange={event => setProjects(event.target.value)} placeholder="HarmonyStudy, JhHarmonyDemo" />
            </Field>
          </>
        ) : (
          <>
            <Field label="目标项目目录" wide>
              <div className="path-row">
                <input value={repo} onChange={event => setRepo(event.target.value)} placeholder="D:\cursor\workplace\project\HarmonyStudy" />
                <button className="folder-button" type="button" onClick={() => handlePickFolder(setRepo)}>
                  <FolderOpen size={15} />
                  选择
                </button>
              </div>
            </Field>
            <Field label="源码目录，可选" wide note="通常可以留空并自动发现；需要限制分析范围时再手动填写。">
              <textarea value={sourceDir} onChange={event => setSourceDir(event.target.value)} placeholder="entry/src/main/ets" />
            </Field>
          </>
        )}

        <Field label="输出目录，可选" wide>
          <div className="path-row">
            <input value={outputDir} onChange={event => setOutputDir(event.target.value)} placeholder="留空时使用 ArkTaint 默认输出目录" />
            <button className="folder-button" type="button" onClick={() => handlePickFolder(setOutputDir)}>
              <FolderOpen size={15} />
              选择
            </button>
          </div>
        </Field>
      </div>
    </section>
  );

  const renderStrategyPanel = () => (
    <section className="surface-panel config-panel">
      <div className="panel-heading">
        <span className="icon-badge"><Settings2 size={16} /></span>
        <div>
          <strong>分析策略</strong>
          <p>默认值适合第一次运行；只有需要控制精度、速度或输出粒度时再调整。</p>
        </div>
      </div>

      <div className="form-grid relaxed">
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
        <Field label="UDE">
          <select value={executionHandoff} onChange={event => setExecutionHandoff(event.target.value)} disabled={taskMode === 'batch'}>
            <option value="enabled">启用</option>
            <option value="disabled">关闭</option>
          </select>
        </Field>
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
        <Field label="增量缓存目录，可选">
          <input value={incrementalCache} onChange={event => setIncrementalCache(event.target.value)} placeholder="留空时使用默认缓存目录" />
        </Field>
      </div>

      <div className="toggle-grid">
        <ToggleLine checked={incremental} onChange={setIncremental} title="增量缓存" desc="保留增量分析结果，适合同一项目的重复对照。" />
        <ToggleLine checked={stopOnFirstFlow} onChange={setStopOnFirstFlow} title="首条流即停" desc="用于快速验证路径是否存在，不适合完整统计。" />
      </div>
    </section>
  );

  const renderSemanticPanel = () => (
    <section className="surface-panel config-panel accent-panel">
      <div className="panel-heading">
        <span className="icon-badge"><Bot size={16} /></span>
        <div>
          <strong>SemanticFlow 与 LLM 建模</strong>
          <p>只有项目存在未知 API 或需要补充语义时才开启；模型切换只影响本次建模请求，不改变分析算法。</p>
        </div>
      </div>

      <div className="toggle-grid leading-toggle">
        <ToggleLine
          checked={autoModel}
          onChange={setAutoModel}
          title="启用自动建模"
          desc="把未知 API 候选交给 SemanticFlow，自动生成可复用产物。"
          disabled={taskMode === 'inspect'}
        />
      </div>

      <div className="form-grid relaxed">
        <Field label="LLM 配置名">
          <input value={llmProfile} onChange={event => setLlmProfile(event.target.value)} placeholder="qwen" />
        </Field>
        <Field label="模型">
          <>
            <input list="arktaint-llm-models" value={llmModel} onChange={event => setLlmModel(event.target.value)} placeholder="qwen3-coder-next" />
            <datalist id="arktaint-llm-models">
              {modelOptions.map(model => <option key={model} value={model} />)}
            </datalist>
          </>
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
        <Field label="发布模型包 ID，可选">
          <input value={publishModel} onChange={event => setPublishModel(event.target.value)} placeholder="自动建模完成后发布到指定模型包 ID" />
        </Field>
        <Field label="会话缓存目录" wide>
          <input value={llmSessionCacheDir} onChange={event => setLlmSessionCacheDir(event.target.value)} placeholder="可选：固定 LLM 会话缓存目录" />
        </Field>
      </div>
    </section>
  );

  const renderBatchPanel = () => (
    <section className="surface-panel config-panel accent-panel">
      <div className="panel-heading">
        <span className="icon-badge"><Workflow size={16} /></span>
        <div>
          <strong>批量控制</strong>
          <p>面向真实项目集合时，超时、心跳和分片策略需要独立配置，避免长任务失控。</p>
        </div>
      </div>

      <div className="form-grid relaxed">
        <Field label="最大项目数">
          <input value={maxProjects} onChange={event => setMaxProjects(event.target.value)} placeholder="留空时不限制" />
        </Field>
        <Field label="项目超时，秒">
          <input value={projectTimeoutSeconds} onChange={event => setProjectTimeoutSeconds(event.target.value)} />
        </Field>
        <Field label="心跳间隔，秒">
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
        <Field label="分片超时，秒">
          <input value={sourceDirTimeoutSeconds} onChange={event => setSourceDirTimeoutSeconds(event.target.value)} />
        </Field>
        <Field label="最大分片数">
          <input value={maxSplitSourceDirs} onChange={event => setMaxSplitSourceDirs(event.target.value)} placeholder="0 表示全部" />
        </Field>
      </div>

      <div className="toggle-grid">
        <ToggleLine checked={skipExisting} onChange={setSkipExisting} title="跳过已有结果" desc="已经生成 summary 的项目不再重复运行。" />
      </div>
    </section>
  );

  const renderInspectPanel = () => (
    <section className="surface-panel config-panel accent-panel">
      <div className="panel-heading">
        <span className="icon-badge"><Search size={16} /></span>
        <div>
          <strong>能力检查</strong>
          <p>检查模式只做列出、解释或追踪，不直接进入完整数据流求解。</p>
        </div>
      </div>
      <div className="form-grid relaxed">
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

  const renderExtensionsPanel = () => (
    <div className="workspace-stack">
      <Disclosure
        title="规则、模型与模块"
        hint="补充规则包、模型包、模块约束和 ArkMain 约束，细化项目分析语义。"
        icon={<Layers3 size={16} />}
        open={rulesOpen}
        onToggle={() => setRulesOpen(prev => !prev)}
      >
        <div className="form-grid relaxed">
          <Field label="内核规则">
            <input value={kernelRule} onChange={event => setKernelRule(event.target.value)} />
          </Field>
          <Field label="项目规则">
            <input value={projectRule} onChange={event => setProjectRule(event.target.value)} />
          </Field>
          <Field label="候选规则">
            <input value={candidateRule} onChange={event => setCandidateRule(event.target.value)} />
          </Field>
          <Field label="启用模型">
            <input value={enableModel} onChange={event => setEnableModel(event.target.value)} placeholder="按行或逗号填写模型包 ID" />
          </Field>
          <Field label="禁用模型">
            <input value={disableModel} onChange={event => setDisableModel(event.target.value)} placeholder="按行或逗号填写模型包 ID" />
          </Field>
          <Field label="禁用模块">
            <input value={disableModule} onChange={event => setDisableModule(event.target.value)} placeholder="按行或逗号填写模块 ID" />
          </Field>
          <Field label="模型根目录" wide note="可按行填写多个 model root。">
            <textarea value={modelRoot} onChange={event => setModelRoot(event.target.value)} />
          </Field>
          <Field label="模块约束文件" wide>
            <textarea value={moduleSpec} onChange={event => setModuleSpec(event.target.value)} />
          </Field>
          <Field label="ArkMain 约束文件" wide>
            <textarea value={arkmainSpec} onChange={event => setArkmainSpec(event.target.value)} />
          </Field>
        </div>
      </Disclosure>

      <Disclosure
        title="插件"
        hint="按需启用插件，或用 dry-run / audit 核查扩展能力。"
        icon={<Plug size={16} />}
        open={pluginsOpen}
        onToggle={() => setPluginsOpen(prev => !prev)}
      >
        <div className="form-grid relaxed">
          <Field label="插件路径">
            <input value={plugins} onChange={event => setPlugins(event.target.value)} placeholder="按行或逗号填写插件路径" />
          </Field>
          <Field label="禁用插件">
            <input value={disablePlugins} onChange={event => setDisablePlugins(event.target.value)} placeholder="按行或逗号填写插件名" />
          </Field>
          <Field label="隔离插件" wide>
            <textarea value={pluginIsolate} onChange={event => setPluginIsolate(event.target.value)} placeholder="需要隔离执行的插件名" />
          </Field>
        </div>
        <div className="toggle-grid">
          <ToggleLine checked={pluginDryRun} onChange={setPluginDryRun} title="插件 dry-run" desc="只验证加载和解释，不真正参与分析。" />
          <ToggleLine checked={pluginAudit} onChange={setPluginAudit} title="插件审计" desc="输出插件相关诊断，适合复核扩展能力。" />
        </div>
      </Disclosure>
    </div>
  );

  const renderLaunchPanel = () => (
    <section className="surface-panel run-card launch-action-card">
      <div className="panel-heading compact">
        <span className="icon-badge"><CheckCircle2 size={16} /></span>
        <div>
          <strong>配置完成后运行</strong>
          <p>完成必要项后，从这里启动分析；运行过程会切换到独立流程页。</p>
        </div>
      </div>
      <div className="readiness-list">
        <div>
          <span>项目范围</span>
          <strong className={scopeReady ? 'ok' : 'warn'}>{scopeReady ? '已就绪' : '待完成'}</strong>
        </div>
        <div>
          <span>分析策略</span>
          <strong className={strategyReady ? 'ok' : 'warn'}>{strategyReady ? '已就绪' : '待完成'}</strong>
        </div>
        <div>
          <span>检查目标</span>
          <strong className={inspectReady ? 'ok' : 'warn'}>{inspectReady ? '已就绪' : '待完成'}</strong>
        </div>
      </div>
      <button className="primary-button run-button" type="button" disabled={!canRun} onClick={startRun}>
        <Play size={16} />
        {taskMode === 'inspect' ? '开始检查' : '开始分析'}
      </button>
      <button className="secondary-button run-button" type="button" onClick={() => navigateScreen('run')}>
        <Workflow size={16} />
        打开分析流程
      </button>
    </section>
  );

  const renderConfigPanel = () => {
    if (activePanel.id === 'scope') return renderScopePanel();
    if (activePanel.id === 'strategy') return renderStrategyPanel();
    if (activePanel.id === 'semantic') return renderSemanticPanel();
    if (activePanel.id === 'batch') return renderBatchPanel();
    if (activePanel.id === 'inspect') return renderInspectPanel();
    if (activePanel.id === 'launch') return renderLaunchPanel();
    return renderExtensionsPanel();
  };

  const renderLaunchpad = () => (
    <div className={`launchpad-shell view-shell ${viewMotionClass}`}>
      <section className="surface-panel launchpad-board">
        <div className="panel-heading launchpad-head">
          <span className="icon-badge"><PanelRightOpen size={16} /></span>
          <div>
            <strong>选择运行方式</strong>
            <p>只选本次要做的事。不同任务进入不同配置页，运行和日志在流程页单独展示。</p>
          </div>
        </div>

        <section className="task-choice-grid" aria-label="选择分析任务">
          {modeCards.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`task-choice ${taskMode === item.id ? 'active' : ''}`}
                onClick={() => applyPreset(item.id)}
              >
                <span className="task-choice-icon"><Icon size={18} /></span>
                <span className="task-choice-copy">
                  <em>{item.hint}</em>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </span>
                <span className="task-choice-action">
                  {item.action}
                  <ArrowRight size={15} />
                </span>
              </button>
            );
          })}
        </section>
      </section>

      <aside className="launchpad-side">
        <section className={`bridge-state ${bridgeError ? 'error' : bridgeConfig?.valid ? 'ok' : 'warn'}`}>
          <strong>{bridgeError ? '桥接未连接' : bridgeConfig?.valid ? '桥接已连接' : '等待桥接'}</strong>
          <span>{bridgeError || `默认根目录：${bridgeConfig?.defaultArkTaintRoot || '-'}`}</span>
        </section>

        <section className="launchpad-process surface-panel">
          <div className="panel-heading">
            <span className="icon-badge"><Workflow size={16} /></span>
            <div>
              <strong>标准链路</strong>
              <p>运行页会按这四个阶段展示状态、产物和实时日志。</p>
            </div>
          </div>
          <ProcessRibbon activePhase={runSnapshot.phase} />
        </section>
      </aside>
    </div>
  );

  const renderConfig = () => (
    <div className={`config-shell view-shell ${viewMotionClass}`}>
      <aside className="config-rail surface-panel">
        <button type="button" className="back-button" onClick={() => navigateScreen('launchpad')}>
          <ArrowLeft size={15} />
          更换任务
        </button>
        <div className="mode-summary">
          <span className="icon-badge"><ActiveModeIcon size={16} /></span>
          <div>
            <em>{activeMode.hint}</em>
            <strong>{activeMode.title}</strong>
          </div>
        </div>
        <nav className="panel-nav" aria-label="配置导航">
          {configPanels.map((item, index) => {
            const Icon = item.icon;
            const ready =
              item.id === 'scope'
                ? scopeReady
                : item.id === 'strategy'
                  ? strategyReady
                  : item.id === 'inspect'
                    ? inspectReady
                    : item.id === 'launch'
                      ? canRun
                    : item.required
                      ? true
                      : false;
            return (
              <button
                key={item.id}
                type="button"
                className={`panel-nav-item ${resolvedConfigPanel === item.id ? 'active' : ''}`}
                onClick={() => setConfigPanel(item.id)}
              >
                <span className="panel-nav-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon size={16} />
                <span>
                  <strong>{item.title}</strong>
                  <em>{item.hint}</em>
                </span>
                <small className={ready ? 'ok' : item.required ? 'warn' : 'muted'}>{statusLabel(ready, !item.required)}</small>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="config-stage">
        <section className="surface-panel summary-card config-summary-card">
          <div className="summary-row-head">
            <span className="icon-badge"><PanelRightOpen size={16} /></span>
            <div>
              <strong>运行摘要</strong>
              <p>确认本次分析的关键口径。</p>
            </div>
          </div>
          <div className="intent-list compact">
            {intentSummary.map(item => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <dl className="summary-list compact">
            <div>
              <dt>范围</dt>
              <dd>{taskMode === 'batch' ? projectRoot || '未选择' : repo || '未选择'}</dd>
            </div>
            <div>
              <dt>源码</dt>
              <dd>{projectSummary}</dd>
            </div>
            <div>
              <dt>SemanticFlow</dt>
              <dd>{autoModel ? `${llmProfile}/${llmModel || '默认模型'}` : '关闭'}</dd>
            </div>
            <div>
              <dt>检查</dt>
              <dd>{taskMode === 'inspect' ? (inspectionOptions.find(item => item.value === inspectionMode)?.label || '未选择') : '不启用'}</dd>
            </div>
          </dl>
        </section>

        <section className="config-title">
          <span className="eyebrow">配置 / {activePanel.title}</span>
          <h3>{activeMode.title}</h3>
          <p>{activeMode.body}</p>
        </section>

          <div key={activePanel.id} className="panel-viewport">
            {renderConfigPanel()}
          </div>

        <div className="config-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!previousPanel}
            onClick={() => previousPanel && setConfigPanel(previousPanel.id)}
          >
            <ArrowLeft size={15} />
            上一项
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!nextPanel}
            onClick={() => nextPanel && setConfigPanel(nextPanel.id)}
          >
            下一项
            <ArrowRight size={15} />
          </button>
        </div>
      </main>

    </div>
  );

  const renderRun = () => (
    <div className={`run-shell view-shell ${viewMotionClass}`}>
      <section className="run-hero surface-panel">
        <div>
          <span className="eyebrow">分析流程</span>
          <h3>{analyzing ? '正在运行 ArkTaint 分析' : '运行控制'}</h3>
          <p>阶段、产物和实时输出集中在当前页面，方便运行时持续观察。</p>
        </div>
        <div className="run-hero-actions">
          <button type="button" className="secondary-button" onClick={() => navigateScreen(screenForMode(taskMode))}>
            <ArrowLeft size={15} />
            回到配置
          </button>
          <button type="button" className="primary-button" disabled={!canRun} onClick={startRun}>
            <Play size={16} />
            {analyzing ? '运行中' : logs.length ? '重新运行' : taskMode === 'inspect' ? '开始检查' : '开始分析'}
          </button>
        </div>
      </section>

      <ProcessRibbon activePhase={runSnapshot.phase} />

      <div className="run-grid">
        <section className="surface-panel runtime-panel">
          <div className="panel-heading compact">
            <span className="icon-badge"><Clock3 size={16} /></span>
            <div>
              <strong>运行状态</strong>
              <p>阶段、项目进度、产物数量和退出码。</p>
            </div>
          </div>
          <div className="runtime-grid">
            <div>
              <span>阶段</span>
              <strong>{runSnapshot.phase}</strong>
            </div>
            <div>
              <span>产物</span>
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

        {runSnapshot.artifacts.length > 0 && (
          <section className="surface-panel artifact-panel">
            <div className="panel-heading compact">
              <span className="icon-badge"><FileText size={16} /></span>
              <div>
                <strong>产物</strong>
                <p>点击产物项可复制路径，便于打开 summary、result 或 session。</p>
              </div>
            </div>
            <div className="artifact-list">
              {runSnapshot.artifacts.map(item => (
                <button
                  key={`${item.label}-${item.path}`}
                  type="button"
                  className="artifact-card"
                  onClick={() => navigator.clipboard?.writeText(item.path)}
                  title="点击复制路径"
                >
                  <strong>{item.label}</strong>
                  <span>{item.path}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="surface-panel terminal-panel">
        <div className="panel-heading compact">
          <span className="icon-badge"><SquareTerminal size={16} /></span>
          <div>
            <strong>运行输出</strong>
            <p>这里展示 ArkTaint 桥接服务和分析引擎的实时输出。</p>
          </div>
        </div>
        <div className="terminal-stats">
          <span><CheckCircle2 size={14} /> 完成 {countLogs(logs, 'done')}</span>
          <span><Sparkles size={14} /> 系统 {countLogs(logs, 'sys')}</span>
          <span><Search size={14} /> 日志 {countLogs(logs, 'log')}</span>
          <span><Gauge size={14} /> 错误 {countLogs(logs, 'error')}</span>
        </div>
        <div className="terminal-feed">
          {logs.length === 0 ? (
            <div className="terminal-empty">
              <strong>尚未开始运行</strong>
              <span>点击开始后，这里会显示实时执行输出。</span>
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

      {logs.length > 0 && !analyzing && (
        <section className="surface-panel run-history-note">
          <strong>上次运行</strong>
          <span>退出码：{runSnapshot.exitCode ?? 'unknown'} · 产物：{runSnapshot.artifacts.length} · 日志：{logs.length}</span>
        </section>
      )}
    </div>
  );

  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <div>
          <span className="eyebrow">ArkTaint Console</span>
          <h2>分析工作台</h2>
          <p>任务、配置和运行过程分开管理。</p>
        </div>

        <nav className="workbench-page-tabs" aria-label="工作台页面">
          <button type="button" className={screen === 'launchpad' ? 'active' : ''} onClick={() => navigateScreen('launchpad')}>
            任务选择
          </button>
          <button
            type="button"
            className={screen !== 'launchpad' && screen !== 'run' ? 'active' : ''}
            onClick={() => navigateScreen(screenForMode(taskMode))}
          >
            任务配置
          </button>
          <button type="button" className={screen === 'run' ? 'active' : ''} onClick={() => navigateScreen('run')}>
            分析流程
          </button>
        </nav>
      </header>

      {screen === 'launchpad' ? renderLaunchpad() : screen === 'run' ? renderRun() : renderConfig()}
    </div>
  );
}
