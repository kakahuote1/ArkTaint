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
  Layers3,
  Play,
  Settings2,
  Sparkles,
  SquareTerminal,
  Workflow,
} from 'lucide-react';

type TaskMode = 'batch';
type LogType = 'log' | 'error' | 'sys' | 'done';
type WorkbenchScreen = 'config' | 'llm' | 'run';
type ConfigPanel = 'scope' | 'strategy' | 'enhance' | 'launch';

type BridgeEvent = { type?: LogType; message?: string; time?: string; code?: number | null };
type BridgeConfig = { defaultArkTaintRoot?: string; valid?: boolean; reason?: string; bridgePort?: number };
type LogEntry = { message: string; time: string; type: LogType };
type ArtifactItem = { label: string; path: string };
type UploadedBundle = { bundleName: string; projectRoot: string; detectedProjects: string[]; projectCount: number };
type UploadedPluginBundle = { bundleName: string; pluginRoot: string };
type LlmConfigMode = 'direct' | 'config';
type PluginEntry = { label: string; path: string };
type RunSnapshot = {
  phase: string;
  exitCode?: number | null;
  artifacts: ArtifactItem[];
  selectedProjects?: number;
  currentProjectIndex?: number;
  currentProjectTotal?: number;
  currentProjectName?: string;
};

type ReportPreviewKind = 'markdown' | 'json' | 'text';

const bridgeBaseUrl = import.meta.env.VITE_ARKTAINT_BRIDGE_URL || 'http://localhost:3001';
const storageKey = 'arktaint.console.settings.v8';

const configPanels: Array<{
  id: ConfigPanel;
  title: string;
  hint: string;
  lead: string;
  required?: boolean;
  icon: typeof FolderOpen;
}> = [
  {
    id: 'scope',
    title: '项目接入',
    hint: '确定本次任务对应的真实项目范围',
    lead: '完成项目上传、项目范围识别与结果输出设置，建立本次分析任务的基础上下文。',
    required: true,
    icon: FolderOpen,
  },
  {
    id: 'strategy',
    title: '执行策略',
    hint: '统一设置分析深度与批量执行方式',
    lead: '统一配置本次任务的分析深度、输出方式和批量执行策略，帮助团队在效率与稳定性之间取得平衡。',
    required: true,
    icon: Settings2,
  },
  {
    id: 'enhance',
    title: '建模增强',
    hint: '集中补充语义能力、规则能力与扩展能力',
    lead: '在默认能力基础上补充更完整的业务语义与扩展策略，提升复杂场景下的识别质量。',
    icon: Bot,
  },
  {
    id: 'launch',
    title: '确认启动',
    hint: '确认任务摘要后即可正式启动分析',
    lead: '统一确认项目范围、分析策略与运行参数后，正式启动本次批量分析任务。',
    required: true,
    icon: CheckCircle2,
  },
];

function nowText() {
  return new Date().toLocaleTimeString();
}

function toLog(message: string, type: LogType = 'log', time?: string): LogEntry {
  return { message, type, time: time || nowText() };
}

function readSaved(): Record<string, unknown> {
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
  if (
    text.includes('semanticflow') ||
    text.includes('llm') ||
    text.includes('auto_model') ||
    text.includes('rule') ||
    text.includes('model')
  ) {
    return '建模增强';
  }
  if (
    text.includes('build_scene') ||
    text.includes('pag') ||
    text.includes('executionhandoffaudit') ||
    text.includes('stageprofile')
  ) {
    return '场景构建';
  }
  return '项目接入';
}

function parseArtifact(message: string): ArtifactItem | null {
  const candidates = [
    { marker: 'summary_json=', label: 'Summary JSON' },
    { marker: 'final_summary_json=', label: '最终 Summary JSON' },
    { marker: 'summary_md=', label: 'Summary Markdown' },
    { marker: 'result_json=', label: '结果 JSON' },
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

function parseProjectRunStatus(message: string) {
  const matched = message.match(/\[(\d+)\/(\d+)\]\s+project=([^\s]+)\s+status=([^\s]+)/i);
  if (!matched) return null;

  const statusText = matched[4].toLowerCase();
  if (
    statusText.includes('done') ||
    statusText.includes('ok') ||
    statusText.includes('success') ||
    statusText.includes('skip_recorded')
  ) {
    return { project: matched[3], total: Number(matched[2]), status: 'completed' as const };
  }
  if (statusText.includes('fail') || statusText.includes('error') || statusText.includes('timeout')) {
    return { project: matched[3], total: Number(matched[2]), status: 'failed' as const };
  }
  return null;
}

function parseMultiValue(value: string) {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function mergeUniqueItems(...groups: string[][]) {
  return [...new Set(groups.flat().map(item => item.trim()).filter(Boolean))];
}

function getPathLabel(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : value;
}

function readPluginEntries(raw: unknown): PluginEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .map(item => {
        if (typeof item === 'string') return { label: getPathLabel(item), path: item };
        if (item && typeof item === 'object' && typeof (item as PluginEntry).path === 'string') {
          const entry = item as PluginEntry;
          return {
            label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : getPathLabel(entry.path),
            path: entry.path,
          };
        }
        return null;
      })
      .filter((item): item is PluginEntry => Boolean(item));
  }
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return readPluginEntries(parsed);
  } catch {
    return parseMultiValue(raw).map(item => ({ label: getPathLabel(item), path: item }));
  }
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

function Field({
  label,
  children,
  wide = false,
  note,
  required = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  note?: string;
  required?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>
        {label}
        {required ? <em className="required-mark">*</em> : null}
      </span>
      {children}
      {note ? <small>{note}</small> : null}
    </label>
  );
}

export type { TaskMode };

export default function Workbench() {
  const saved = useMemo(() => readSaved(), []);
  const readText = (key: string, fallback = '') => (typeof saved[key] === 'string' ? String(saved[key]) : fallback);
  const readBool = (key: string, fallback: boolean) => (typeof saved[key] === 'boolean' ? Boolean(saved[key]) : fallback);

  const [screen, setScreen] = useState<WorkbenchScreen>('config');
  const [viewLeaving, setViewLeaving] = useState(false);
  const [configPanel, setConfigPanel] = useState<ConfigPanel>('scope');

  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot>({ phase: '尚未开始', artifacts: [] });

  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [reportPreviewLoading, setReportPreviewLoading] = useState(false);
  const [reportPreviewError, setReportPreviewError] = useState('');
  const [reportPreviewKind, setReportPreviewKind] = useState<ReportPreviewKind>('text');
  const [reportPreviewContent, setReportPreviewContent] = useState('');

  const [outputDir, setOutputDir] = useState(readText('outputDir'));
  const [projectRoot, setProjectRoot] = useState(readText('projectRoot', 'D:\\cursor\\workplace\\project'));
  const [projects, setProjects] = useState(readText('projects'));
  const [uploadedBundleName, setUploadedBundleName] = useState(readText('uploadedBundleName'));
  const [uploadingBundle, setUploadingBundle] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(readText('uploadMessage'));
  const [pluginUploadTarget, setPluginUploadTarget] = useState<'global' | 'project' | null>(null);

  const [profile, setProfile] = useState(readText('profile', 'default'));
  const [executionHandoff] = useState(readText('executionHandoff', 'enabled'));
  const [reportMode, setReportMode] = useState(readText('reportMode', 'light'));
  const [entryModel] = useState(readText('entryModel', 'explicit'));
  const [maxEntries] = useState(readText('maxEntries', '9999'));
  const [k, setK] = useState(readText('k', ''));
  const [secondarySinkSweep] = useState(readText('secondarySinkSweep', 'auto'));

  const [incremental, setIncremental] = useState(readBool('incremental', false));
  const [incrementalCache] = useState(readText('incrementalCache'));
  const [stopOnFirstFlow, setStopOnFirstFlow] = useState(readBool('stopOnFirstFlow', false));
  const [maxFlowsPerEntry] = useState(readText('maxFlowsPerEntry'));
  const [projectTimeoutSeconds, setProjectTimeoutSeconds] = useState(readText('projectTimeoutSeconds', ''));
  const [heartbeatSeconds] = useState(readText('heartbeatSeconds', '30'));
  const [sourceDirMode] = useState(readText('sourceDirMode', 'auto'));
  const [splitSourceDirThreshold] = useState(readText('splitSourceDirThreshold', '24'));
  const [sourceDirTimeoutSeconds] = useState(readText('sourceDirTimeoutSeconds', '90'));
  const [maxSplitSourceDirs] = useState(readText('maxSplitSourceDirs', '0'));
  const [maxProjects] = useState(readText('maxProjects'));
  const [skipExisting, setSkipExisting] = useState(readBool('skipExisting', true));

  const autoModel = true;
  const [llmConfigMode, setLlmConfigMode] = useState((readText('llmConfigMode', 'direct') as LlmConfigMode) || 'direct');
  const [llmApiUrl, setLlmApiUrl] = useState(readText('llmApiUrl'));
  const [llmApiKey, setLlmApiKey] = useState(readText('llmApiKey'));
  const [llmApiKeyHeader, setLlmApiKeyHeader] = useState(readText('llmApiKeyHeader', 'Authorization'));
  const [llmApiKeyPrefix, setLlmApiKeyPrefix] = useState(readText('llmApiKeyPrefix', 'Bearer '));
  const [llmHeaders, setLlmHeaders] = useState(readText('llmHeaders'));
  const [llmMinIntervalMs, setLlmMinIntervalMs] = useState(readText('llmMinIntervalMs'));
  const [llmAdvancedOpen, setLlmAdvancedOpen] = useState(readBool('llmAdvancedOpen', false));
  const [llmConfig, setLlmConfig] = useState(readText('llmConfig'));
  const [llmProfile] = useState(readText('llmProfile', 'qwen'));
  const [llmModel, setLlmModel] = useState(readText('llmModel'));
  const [llmTimeoutMs, setLlmTimeoutMs] = useState(readText('llmTimeoutMs', '45000'));
  const [llmConnectTimeoutMs, setLlmConnectTimeoutMs] = useState(() => {
    const value = readText('llmConnectTimeoutMs');
    return value.trim() || '120000';
  });
  const [llmMaxAttempts, setLlmMaxAttempts] = useState(readText('llmMaxAttempts', '1'));
  const [llmMaxFailures, setLlmMaxFailures] = useState(readText('llmMaxFailures', '3'));
  const [llmRepairAttempts, setLlmRepairAttempts] = useState(readText('llmRepairAttempts', '0'));
  const [maxLlmItems] = useState(readText('maxLlmItems', '4'));
  const [publishModel] = useState(readText('publishModel'));

  const [globalPlugins, setGlobalPlugins] = useState<PluginEntry[]>(() => readPluginEntries(saved.globalPlugins));
  const [projectRule, setProjectRule] = useState(readText('projectRule'));
  const [moduleSpec, setModuleSpec] = useState(readText('moduleSpec'));
  const [projectPlugins, setProjectPlugins] = useState<PluginEntry[]>(() => readPluginEntries(saved.projectPlugins ?? saved.plugins));
  const [useGlobalPlugins, setUseGlobalPlugins] = useState(readBool('useGlobalPlugins', true));
  const [rulesOpen] = useState(readBool('rulesOpen', false));

  const projectList = useMemo(() => cleanLines(projects), [projects]);
  const globalPluginList = useMemo(() => globalPlugins, [globalPlugins]);
  const projectPluginList = useMemo(() => projectPlugins, [projectPlugins]);
  const effectivePluginList = useMemo(
    () => mergeUniqueItems(
      useGlobalPlugins ? globalPluginList.map(item => item.path) : [],
      projectPluginList.map(item => item.path)
    ),
    [globalPluginList, projectPluginList, useGlobalPlugins]
  );
  const selectedProjectCount = projectList.length;
  const bridgeReady = Boolean(bridgeConfig?.valid) && !bridgeError;
  const scopeReady = bridgeReady && Boolean(projectRoot.trim()) && selectedProjectCount > 0;
  const strategyReady = Boolean(profile && reportMode);
  const llmDirectReady = Boolean(llmModel.trim() && llmApiUrl.trim() && llmApiKey.trim());
  const llmReady = llmConfigMode === 'direct' ? llmDirectReady : Boolean(llmConfig.trim());
  const enhanceReady = Boolean(projectRule.trim() || moduleSpec.trim() || effectivePluginList.length);
  const canRun = scopeReady && strategyReady && llmReady && !analyzing;
  const llmPanelStatusLabel = llmReady ? '已完成' : '未完成';

  const runResultSummary = useMemo(() => {
    const projectStates = new Map<string, 'completed' | 'failed'>();
    let detectedTotal = 0;

    for (const log of logs) {
      const parsed = parseProjectRunStatus(log.message);
      if (!parsed) continue;
      detectedTotal = Math.max(detectedTotal, parsed.total);
      projectStates.set(parsed.project, parsed.status);
    }

    let completed = 0;
    let failed = 0;
    for (const state of projectStates.values()) {
      if (state === 'completed') completed += 1;
      if (state === 'failed') failed += 1;
    }

    const total =
      runSnapshot.currentProjectTotal || runSnapshot.selectedProjects || detectedTotal || selectedProjectCount || 0;

    return { total, completed, failed };
  }, [logs, runSnapshot.currentProjectTotal, runSnapshot.selectedProjects, selectedProjectCount]);

  const previewArtifact = useMemo(() => {
    const preferredLabels = ['Summary Markdown', 'Summary JSON', '鏈€缁?Summary JSON'];
    for (const label of preferredLabels) {
      const matched = runSnapshot.artifacts.find(item => item.label === label);
      if (matched) return matched;
    }
    return null;
  }, [runSnapshot.artifacts]);

  const payload = useMemo(
    () => ({
      taskMode: 'batch' as TaskMode,
      outputDir,
      projectRoot,
      projects,
      uploadedBundleName,
      uploadMessage,
      profile,
      executionHandoff,
      reportMode,
      entryModel,
      maxEntries,
      k,
      secondarySinkSweep,
      incremental,
      incrementalCache,
      stopOnFirstFlow,
      maxFlowsPerEntry,
      projectTimeoutSeconds,
      heartbeatSeconds,
      sourceDirMode,
      splitSourceDirThreshold,
      sourceDirTimeoutSeconds,
      maxSplitSourceDirs,
      maxProjects,
      skipExisting,
      autoModel,
      llmConfigMode,
      llmApiUrl,
      llmApiKey,
      llmApiKeyHeader,
      llmApiKeyPrefix,
      llmHeaders,
      llmMinIntervalMs,
      llmAdvancedOpen,
      llmUseDirectConfig: llmConfigMode === 'direct',
      llmConfig,
      llmProfile,
      llmModel,
      llmTimeoutMs,
      llmConnectTimeoutMs,
      llmMaxAttempts,
      llmMaxFailures,
      llmRepairAttempts,
      maxLlmItems,
      publishModel,
      globalPlugins,
      projectRule,
      moduleSpec,
      projectPlugins,
      useGlobalPlugins,
      plugins: effectivePluginList.join('\n'),
      rulesOpen,
    }),
    [
      outputDir,
      projectRoot,
      projects,
      uploadedBundleName,
      uploadMessage,
      profile,
      executionHandoff,
      reportMode,
      entryModel,
      maxEntries,
      k,
      secondarySinkSweep,
      incremental,
      incrementalCache,
      stopOnFirstFlow,
      maxFlowsPerEntry,
      projectTimeoutSeconds,
      heartbeatSeconds,
      sourceDirMode,
      splitSourceDirThreshold,
      sourceDirTimeoutSeconds,
      maxSplitSourceDirs,
      maxProjects,
      skipExisting,
      autoModel,
      llmConfigMode,
      llmApiUrl,
      llmApiKey,
      llmApiKeyHeader,
      llmApiKeyPrefix,
      llmHeaders,
      llmMinIntervalMs,
      llmAdvancedOpen,
      llmConfig,
      llmProfile,
      llmModel,
      llmTimeoutMs,
      llmConnectTimeoutMs,
      llmMaxAttempts,
      llmMaxFailures,
      llmRepairAttempts,
      maxLlmItems,
      publishModel,
      globalPlugins,
      projectRule,
      moduleSpec,
      projectPlugins,
      useGlobalPlugins,
      effectivePluginList,
      rulesOpen,
    ]
  );

  const resolvedConfigPanel = configPanels.some(item => item.id === configPanel) ? configPanel : configPanels[0].id;
  const activePanel = configPanels.find(item => item.id === resolvedConfigPanel) || configPanels[0];
  const currentIndex = configPanels.findIndex(item => item.id === resolvedConfigPanel);
  const previousPanel = currentIndex > 0 ? configPanels[currentIndex - 1] : null;
  const nextPanel = currentIndex < configPanels.length - 1 ? configPanels[currentIndex + 1] : null;
  const viewMotionClass = viewLeaving ? 'is-leaving' : '';

  const navigateScreen = (next: WorkbenchScreen) => {
    if (next === screen || viewLeaving) return;
    setViewLeaving(true);
    window.setTimeout(() => {
      setScreen(next);
      setViewLeaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
  };

  useEffect(() => {
    fetch(`${bridgeBaseUrl}/api/config`)
      .then(response => {
        if (!response.ok) throw new Error('bridge unavailable');
        return response.json();
      })
      .then((config: BridgeConfig) => {
        setBridgeConfig(config);
        setBridgeError('');
      })
      .catch(() => setBridgeError('本地桥接服务未连接，请先在 arktaint-frontend 目录运行 node server.js。'));
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [payload]);

  const handlePickFolder = async (setter: (value: string) => void) => {
    try {
      const response = await fetch(`${bridgeBaseUrl}/api/pick-folder`);
      if (!response.ok) throw new Error('目录选择失败');
      const data = await response.json();
      if (data.path) setter(data.path);
    } catch {
      setBridgeError('目录选择不可用，请确认本地桥接服务已经启动。');
    }
  };

  const uploadBundle = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setUploadMessage('目前只支持上传 zip 压缩包。');
      return;
    }

    setUploadingBundle(true);
    setUploadMessage(`正在上传 ${file.name}...`);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('读取压缩包失败'));
        reader.readAsDataURL(file);
      });

      const response = await fetch(`${bridgeBaseUrl}/api/upload-project-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentBase64,
        }),
      });
      if (!response.ok) {
        const raw = await response.text();
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          throw new Error(parsed.error || raw);
        } catch {
          throw new Error(raw);
        }
      }
      const data = (await response.json()) as UploadedBundle;
      setUploadedBundleName(data.bundleName);
      setProjectRoot(data.projectRoot);
      setProjects(data.detectedProjects.join('\n'));
      setUploadMessage(`已上传 ${data.bundleName}，识别到 ${data.projectCount} 个项目。`);
    } catch (error) {
      setUploadMessage(String((error as Error)?.message || error));
    } finally {
      setUploadingBundle(false);
    }
  };

  const handlePickFile = async (setter: (value: string) => void, filterName: string, filterPattern: string) => {
    try {
      const response = await fetch(
        `${bridgeBaseUrl}/api/pick-file?filterName=${encodeURIComponent(filterName)}&filterPattern=${encodeURIComponent(filterPattern)}`
      );
      if (!response.ok) throw new Error('文件选择失败');
      const data = await response.json();
      if (data.path) setter(data.path);
    } catch {
      setBridgeError('文件选择不可用，请确认本地桥接服务已经启动。');
    }
  };

  const appendPlugin = (entry: PluginEntry, scope: 'global' | 'project') => {
    const currentList = scope === 'global' ? globalPluginList : projectPluginList;
    const nextList = [...currentList.filter(item => item.path !== entry.path), entry];
    if (scope === 'global') {
      setGlobalPlugins(nextList);
      return;
    }
    setProjectPlugins(nextList);
  };

  const removePlugin = (target: string, scope: 'global' | 'project') => {
    const nextList = (scope === 'global' ? globalPluginList : projectPluginList).filter(item => item.path !== target);
    if (scope === 'global') {
      setGlobalPlugins(nextList);
      return;
    }
    setProjectPlugins(nextList);
  };

  const uploadPluginBundle = async (file: File, scope: 'global' | 'project') => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setBridgeError('当前只支持上传 zip 格式的插件包。');
      return;
    }

    setPluginUploadTarget(scope);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('读取插件包失败'));
        reader.readAsDataURL(file);
      });

      const response = await fetch(`${bridgeBaseUrl}/api/upload-plugin-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentBase64,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as UploadedPluginBundle;
      appendPlugin({ label: data.bundleName, path: data.pluginRoot }, scope);
      setBridgeError('');
    } catch (error) {
      setBridgeError(String((error as Error)?.message || error));
    } finally {
      setPluginUploadTarget(null);
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

  const startRun = async () => {
    if (!canRun) return;

    navigateScreen('run');
    setAnalyzing(true);
    setReportPreviewOpen(false);
    setReportPreviewLoading(false);
    setReportPreviewError('');
    setReportPreviewContent('');
    setReportPreviewKind('text');
    setLogs([
      toLog(`连接本地桥接服务：${bridgeBaseUrl}`, 'sys'),
      toLog(`项目集合目录：${projectRoot.trim()}`, 'sys'),
      toLog(uploadedBundleName ? `上传压缩包：${uploadedBundleName}` : '未记录上传压缩包名称', 'sys'),
      toLog(selectedProjectCount > 0 ? `本次显式指定项目数：${selectedProjectCount}` : '本次将按目录自动发现项目', 'sys'),
    ]);
    setRunSnapshot({
      phase: '项目接入',
      artifacts: [],
      selectedProjects: selectedProjectCount || undefined,
    });

    try {
      const response = await fetch(`${bridgeBaseUrl}/api/batch-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          projectRoot: projectRoot.trim(),
          outputDir: outputDir.trim(),
        }),
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
            } else if (data.message) {
              appendLog(data.message, data.type || 'log', data.time);
            }
          } catch {
            // 忽略异常流片段
          }
        }
      }
    } catch (error) {
      appendLog(String((error as Error)?.message || error), 'error');
      setAnalyzing(false);
    }
  };

  const openReportPreview = async () => {
    if (!previewArtifact) return;

    setReportPreviewOpen(true);
    setReportPreviewLoading(true);
    setReportPreviewError('');

    try {
      const response = await fetch(
        `${bridgeBaseUrl}/api/report-preview?path=${encodeURIComponent(previewArtifact.path)}`
      );
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { kind: ReportPreviewKind; content: string };
      setReportPreviewKind(data.kind);
      if (data.kind === 'json') {
        try {
          setReportPreviewContent(JSON.stringify(JSON.parse(data.content), null, 2));
        } catch {
          setReportPreviewContent(data.content);
        }
      } else {
        setReportPreviewContent(data.content);
      }
    } catch (error) {
      setReportPreviewError(String((error as Error)?.message || error));
    } finally {
      setReportPreviewLoading(false);
    }
  };

  const downloadReport = () => {
    if (!previewArtifact) return;

    const url = `${bridgeBaseUrl}/api/report-download?path=${encodeURIComponent(previewArtifact.path)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const statusLabel = (ready: boolean, optional = false) => {
    if (ready) return '已就绪';
    if (optional) return '可选';
    return '待完成';
  };

  const panelReady = (panelId: ConfigPanel) => {
    if (panelId === 'scope') return scopeReady;
    if (panelId === 'strategy') return strategyReady;
    if (panelId === 'enhance') return enhanceReady;
    if (panelId === 'launch') return scopeReady && strategyReady && llmReady;
    return canRun;
  };

  const renderScopePanel = () => (
    <section className="surface-panel config-panel">
      <div className="panel-heading">
        <span className="icon-badge"><FolderOpen size={16} /></span>
        <div>
          <strong>项目接入</strong>
          <p>上传真实项目压缩包后，系统将自动完成接入准备并进入后续分析流程。</p>
        </div>
      </div>
      <div className="form-grid relaxed">
        <Field label="项目集合目录" wide>
          <div className="upload-card">
            <div className="upload-copy">
              <strong>{uploadedBundleName || '上传项目压缩包'}</strong>
              <span>上传后自动完成解压与识别，直接进入分析准备阶段。</span>
            </div>
            <label className={`folder-button upload-button ${uploadingBundle ? 'disabled' : ''}`}>
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={uploadingBundle}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadBundle(file);
                    event.target.value = '';
                  }
                }}
              />
              <FolderOpen size={14} />
              {uploadingBundle ? '上传中' : '选择 zip'}
            </label>
          </div>
          <div className={`validation-note ${uploadedBundleName ? 'ok' : uploadMessage ? 'pending' : 'idle'}`}>
            {uploadMessage || '支持上传包含多个真实项目的 zip 压缩包。'}
          </div>
        </Field>

        <Field label="识别到的项目" wide note="系统将自动识别项目列表，也可按需调整分析范围。">
          <textarea value={projects} onChange={event => setProjects(event.target.value)} />
        </Field>

        <Field label="输出目录" wide note="未指定时，系统将使用默认结果输出位置。">
          <div className="path-row">
            <input value={outputDir} readOnly placeholder="选择分析结果输出位置" />
            <button type="button" className="folder-button" onClick={() => handlePickFolder(setOutputDir)}>
              <FolderOpen size={14} />
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
          <strong>执行策略</strong>
          <p>统一设置分析深度、结果输出方式与批量执行节奏，确保任务执行清晰一致。</p>
        </div>
      </div>

        <div className="form-grid relaxed">
          <Field label="分析深度">
            <select value={profile} onChange={event => setProfile(event.target.value)}>
              <option value="fast">快速筛查</option>
              <option value="default">标准分析</option>
              <option value="strict">深度复核</option>
            </select>
          </Field>
          <Field label="报告模式">
            <select value={reportMode} onChange={event => setReportMode(event.target.value)}>
              <option value="light">简要结果</option>
              <option value="full">完整结果</option>
            </select>
          </Field>
          <Field label="上下文敏感层数（k）">
            <input
              value={k}
              onChange={event => setK(event.target.value)}
              placeholder="未填写时采用系统默认策略（默认值：1）"
            />
          </Field>
          <Field label="单个项目最长等待时间（秒）">
            <input
              value={projectTimeoutSeconds}
              onChange={event => setProjectTimeoutSeconds(event.target.value)}
              placeholder="未填写时采用系统默认策略（默认值：480）"
            />
          </Field>
        </div>

        <div className="toggle-grid">
          <ToggleLine checked={incremental} onChange={setIncremental} title="启用增量分析" desc="复用已有分析结果，适合持续回归与重复验证场景。" />
          <ToggleLine checked={skipExisting} onChange={setSkipExisting} title="跳过已分析项目" desc="自动复用已完成项目结果，提升批量任务执行效率。" />
          <ToggleLine checked={stopOnFirstFlow} onChange={setStopOnFirstFlow} title="发现首个风险后停止" desc="用于快速确认目标项目中是否存在有效风险路径。" />
        </div>
      </section>
    );

  const renderEnhancePanel = () => (
    <section className="workspace-stack">
      <section className="surface-panel config-panel">
        <div className="panel-heading">
          <span className="icon-badge"><Layers3 size={16} /></span>
          <div>
            <strong>项目增强配置</strong>
            <p>按需补充规则文件、模块建模与扩展插件，提升当前项目的语义识别能力。</p>
          </div>
        </div>
        <div className="form-grid relaxed">
          <Field label="规则文件" wide note="适合补充项目专属规则，帮助系统更准确理解业务场景。">
            <div className="path-row">
              <input value={projectRule} readOnly placeholder="选择项目规则文件" />
              <button type="button" className="folder-button" onClick={() => handlePickFile(setProjectRule, 'JSON Files', '*.json')}>
                <FolderOpen size={14} />
                选择
              </button>
            </div>
          </Field>
          <Field label="模块建模文件" wide note="用于补充复杂模块的传播语义和结构建模。">
            <div className="path-row">
              <input value={moduleSpec} readOnly placeholder="选择模块建模文件" />
              <button type="button" className="folder-button" onClick={() => handlePickFile(setModuleSpec, 'JSON Files', '*.json')}>
                <FolderOpen size={14} />
                选择
              </button>
            </div>
          </Field>
          <Field label="扩展插件" wide note="按需添加当前项目需要的额外分析能力，并可选择继承全局默认插件。">
            <div className="plugin-stack">
              <ToggleLine
                checked={useGlobalPlugins}
                onChange={setUseGlobalPlugins}
                title="使用全局默认插件"
                desc={
                  globalPluginList.length
                    ? useGlobalPlugins
                      ? `当前已继承 ${globalPluginList.length} 个全局插件。`
                      : `当前可继承 ${globalPluginList.length} 个全局插件。`
                    : '当前尚未配置全局默认插件。'
                }
              />
              <div className="plugin-group">
                <div className="plugin-actions">
                  <label className={`folder-button upload-button ${pluginUploadTarget === 'project' ? 'disabled' : ''}`}>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      disabled={pluginUploadTarget !== null}
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadPluginBundle(file, 'project');
                          event.target.value = '';
                        }
                      }}
                    />
                    <FolderOpen size={14} />
                    {pluginUploadTarget === 'project' ? '上传中...' : '添加插件包'}
                  </label>
                </div>
                {projectPluginList.length === 0 ? (
                  <div className="plugin-empty">当前未添加项目插件。</div>
                ) : (
                  <div className="plugin-list">
                    {projectPluginList.map(item => (
                      <div key={`project-${item.path}`} className="plugin-item">
                        <span className="plugin-copy">
                          <strong>{item.label}</strong>
                          <em>{item.path}</em>
                        </span>
                        <button type="button" className="plugin-remove" onClick={() => removePlugin(item.path, 'project')}>
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Field>
        </div>
      </section>
    </section>
  );

  const renderLlmConfig = () => (
    <div className={`llm-shell view-shell ${viewMotionClass}`}>
      <section className="llm-hero surface-panel">
        <div>
          <span className="eyebrow">全局能力配置</span>
          <h3>统一管理全局分析能力</h3>
        </div>
        <div className="llm-status-card">
          <div className="llm-status-grid">
            <div className="llm-status-box polished">
              <span>LLM 辅助建模</span>
              <em className={llmReady ? 'ok' : 'warn'}>{llmPanelStatusLabel}</em>
            </div>
            <div className="llm-status-box polished">
              <span>全局默认插件</span>
              <em className="muted">可选</em>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-panel config-panel accent-panel">
        <div className="panel-heading">
          <span className="icon-badge"><Sparkles size={16} /></span>
          <div>
            <strong>LLM 辅助建模</strong>
            <p>用于接入大模型能力，帮助系统补充 API 语义和业务行为理解，提升复杂项目中的分析覆盖度。</p>
          </div>
        </div>
        <div className="form-grid relaxed">
          <Field label="配置方式" wide>
            <select value={llmConfigMode} onChange={event => setLlmConfigMode(event.target.value as LlmConfigMode)}>
              <option value="direct">直接填写 API 配置</option>
              <option value="config">使用已有配置文件</option>
            </select>
          </Field>

          {llmConfigMode === 'direct' ? (
            <>
              <Field label="接口地址" wide required>
                <input
                  value={llmApiUrl}
                  onChange={event => setLlmApiUrl(event.target.value)}
                  placeholder="例如 https://api.openai.com/v1"
                />
              </Field>
              <Field label="API Key" required>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={event => setLlmApiKey(event.target.value)}
                  placeholder="输入模型服务的 API Key"
                />
              </Field>
              <Field label="模型" required>
                <input
                  value={llmModel}
                  onChange={event => setLlmModel(event.target.value)}
                  placeholder="输入模型名称"
                />
              </Field>

              <div className="advanced-section wide">
                <button
                  type="button"
                  className={`advanced-toggle ${llmAdvancedOpen ? 'open' : ''}`}
                  onClick={() => setLlmAdvancedOpen(value => !value)}
                >
                  <span>高级配置</span>
                  <ChevronDown size={16} />
                </button>
              </div>

              {llmAdvancedOpen ? (
                <>
                  <Field label="API Key Header">
                    <input
                      value={llmApiKeyHeader}
                      onChange={event => setLlmApiKeyHeader(event.target.value)}
                      placeholder="默认 Authorization"
                    />
                  </Field>
                  <Field label="API Key Prefix">
                    <input
                      value={llmApiKeyPrefix}
                      onChange={event => setLlmApiKeyPrefix(event.target.value)}
                      placeholder="默认 Bearer "
                    />
                  </Field>
                  <Field label="连接超时 (ms)">
                    <input value={llmConnectTimeoutMs} onChange={event => setLlmConnectTimeoutMs(event.target.value)} />
                  </Field>
                  <Field label="请求超时 (ms)">
                    <input value={llmTimeoutMs} onChange={event => setLlmTimeoutMs(event.target.value)} />
                  </Field>
                  <Field label="最大尝试次数">
                    <input value={llmMaxAttempts} onChange={event => setLlmMaxAttempts(event.target.value)} />
                  </Field>
                  <Field label="最大失败次数">
                    <input value={llmMaxFailures} onChange={event => setLlmMaxFailures(event.target.value)} />
                  </Field>
                  <Field label="修复尝试次数">
                    <input value={llmRepairAttempts} onChange={event => setLlmRepairAttempts(event.target.value)} />
                  </Field>
                  <Field label="最小调用间隔 (ms)">
                    <input
                      value={llmMinIntervalMs}
                      onChange={event => setLlmMinIntervalMs(event.target.value)}
                      placeholder="按需填写"
                    />
                  </Field>
                  <Field label="自定义 Headers" wide>
                    <textarea
                      value={llmHeaders}
                      onChange={event => setLlmHeaders(event.target.value)}
                      placeholder={'Header-Name: value\nAnother-Header: value'}
                    />
                  </Field>
                </>
              ) : null}
            </>
          ) : (
            <>
              <Field label="LLM 配置文件" wide required>
                <div className="path-row">
                  <input value={llmConfig} readOnly placeholder="选择已有的 LLM 配置文件" />
                  <button type="button" className="folder-button" onClick={() => handlePickFile(setLlmConfig, 'JSON Files', '*.json')}>
                    <FolderOpen size={14} />
                    选择
                  </button>
                </div>
              </Field>
            </>
          )}

        </div>
      </section>

      <section className="surface-panel config-panel">
        <div className="panel-heading">
          <span className="icon-badge"><Layers3 size={16} /></span>
          <div>
            <strong>全局默认插件</strong>
            <p>用于统一管理团队常用的扩展能力，让多个项目在分析时复用同一套插件配置。</p>
          </div>
        </div>
        <div className="plugin-stack">
          <div className="plugin-actions">
            <label className={`folder-button upload-button ${pluginUploadTarget === 'global' ? 'disabled' : ''}`}>
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={pluginUploadTarget !== null}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadPluginBundle(file, 'global');
                    event.target.value = '';
                  }
                }}
              />
              <FolderOpen size={14} />
              {pluginUploadTarget === 'global' ? '上传中...' : '添加插件包'}
            </label>
          </div>
          {globalPluginList.length === 0 ? (
            <div className="plugin-empty">当前未配置全局默认插件。</div>
          ) : (
            <div className="plugin-list">
              {globalPluginList.map(item => (
                <div key={`global-manage-${item.path}`} className="plugin-item">
                  <span className="plugin-copy">
                    <strong>{item.label}</strong>
                    <em>{item.path}</em>
                  </span>
                  <button type="button" className="plugin-remove" onClick={() => removePlugin(item.path, 'global')}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderLaunchPanel = () => {
    const depthLabel =
      profile === 'fast' ? '快速筛查' : profile === 'strict' ? '深度复核' : '标准分析';
    const reportLabel = reportMode === 'full' ? '完整结果' : '简要结果';
    const llmModeLabel = llmConfigMode === 'direct' ? '直接填写 API 配置' : '使用已有配置文件';
    const launchIssues = [
      !scopeReady ? '请先补充项目接入信息。' : '',
      !strategyReady ? '请先补充分析策略。' : '',
      !llmReady ? '请先完成 LLM 辅助建模配置。' : '',
    ].filter(Boolean);

    return (
      <section className="surface-panel config-panel launch-summary-panel">
        <div className="panel-heading">
          <span className="icon-badge"><CheckCircle2 size={16} /></span>
          <div>
            <strong>确认启动</strong>
            <p>启动前快速确认本次分析的范围、策略和能力配置。</p>
          </div>
        </div>

        <div className="launch-summary-grid">
          <section className="config-summary-card">
            <div className="summary-row-head">
              <span className="icon-badge"><FolderOpen size={15} /></span>
              <div>
                <strong>分析范围</strong>
                <p>用于确认本次任务的分析对象范围及结果输出位置。</p>
              </div>
            </div>
            <dl className="summary-list">
              <div>
                <dt>项目目录</dt>
                <dd>{projectRoot.trim() || '未选择'}</dd>
              </div>
              <div>
                <dt>项目数量</dt>
                <dd>{selectedProjectCount > 0 ? `${selectedProjectCount} 个` : '未选择'}</dd>
              </div>
              <div>
                <dt>输出目录</dt>
                <dd>{outputDir.trim() || '未选择'}</dd>
              </div>
            </dl>
          </section>

          <section className="config-summary-card">
            <div className="summary-row-head">
              <span className="icon-badge"><Settings2 size={15} /></span>
              <div>
                <strong>分析策略</strong>
                <p>用于确认本次任务的分析深度、结果输出方式及批量执行策略。</p>
              </div>
            </div>
            <dl className="summary-list">
              <div>
                <dt>分析深度</dt>
                <dd>{depthLabel}</dd>
              </div>
              <div>
                <dt>报告模式</dt>
                <dd>{reportLabel}</dd>
              </div>
              <div>
                <dt>上下文层数</dt>
                <dd>{k.trim() || '1'}</dd>
              </div>
              <div>
                <dt>最长等待</dt>
                <dd>{projectTimeoutSeconds.trim() ? `${projectTimeoutSeconds.trim()} 秒` : '系统默认（480 秒）'}</dd>
              </div>
              <div>
                <dt>跳过已分析</dt>
                <dd>{skipExisting ? '是' : '否'}</dd>
              </div>
              <div>
                <dt>命中即停</dt>
                <dd>{stopOnFirstFlow ? '是' : '否'}</dd>
              </div>
            </dl>
          </section>

          <section className="config-summary-card">
            <div className="summary-row-head">
              <span className="icon-badge"><Sparkles size={15} /></span>
              <div>
                <strong>全局能力</strong>
                <p>用于确认全局建模能力配置及默认插件能力是否已准备就绪。</p>
              </div>
            </div>
            <dl className="summary-list">
              <div>
                <dt>LLM 建模</dt>
                <dd className={llmReady ? 'ok' : 'warn'}>{llmReady ? '已完成' : '未完成'}</dd>
              </div>
              <div>
                <dt>配置方式</dt>
                <dd>{llmModeLabel}</dd>
              </div>
              <div>
                <dt>插件状态</dt>
                <dd>{globalPluginList.length ? `已配置 ${globalPluginList.length} 个` : '未配置'}</dd>
              </div>
            </dl>
          </section>

          <section className="config-summary-card">
            <div className="summary-row-head">
              <span className="icon-badge"><Layers3 size={15} /></span>
              <div>
                <strong>建模增强</strong>
                <p>用于确认当前项目是否补充了规则文件、模块建模及扩展插件配置。</p>
              </div>
            </div>
            <dl className="summary-list">
              <div>
                <dt>规则文件</dt>
                <dd>{projectRule.trim() ? '已配置' : '未配置'}</dd>
              </div>
              <div>
                <dt>模块建模</dt>
                <dd>{moduleSpec.trim() ? '已配置' : '未配置'}</dd>
              </div>
              <div>
                <dt>项目插件</dt>
                <dd>{projectPluginList.length ? `已添加 ${projectPluginList.length} 个` : '未添加'}</dd>
              </div>
              <div>
                <dt>继承全局</dt>
                <dd>{useGlobalPlugins ? '是' : '否'}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className={`launch-status-note ${launchIssues.length ? 'warn' : 'ok'}`}>
          <strong>{launchIssues.length ? '启动前仍有待补充项' : '已满足启动条件'}</strong>
          <span>{launchIssues.length ? launchIssues.join(' ') : '当前关键信息已确认，可以开始本次分析。'}</span>
        </div>
      </section>
    );
  };

  const renderConfigPanel = () => {
    if (activePanel.id === 'scope') return renderScopePanel();
    if (activePanel.id === 'strategy') return renderStrategyPanel();
    if (activePanel.id === 'enhance') return renderEnhancePanel();
    return renderLaunchPanel();
  };

  const renderConfig = () => (
    <div className={`config-shell view-shell ${viewMotionClass}`}>
      <aside className="config-rail">
        <button type="button" className="back-button" onClick={() => navigateScreen('run')}>
          <Workflow size={14} />
          分析流程
        </button>
        <nav className="panel-nav" aria-label="配置导航">
          {configPanels.map(item => {
            const ready = panelReady(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={`panel-nav-item ${resolvedConfigPanel === item.id ? 'active' : ''}`}
                onClick={() => setConfigPanel(item.id)}
              >
                <span className="panel-nav-label">{item.title}</span>
                <small className={ready ? 'ok' : item.required ? 'warn' : 'muted'}>
                  {statusLabel(ready, !item.required)}
                </small>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="config-stage">
        <section className="config-title">
          <span className="eyebrow">配置 / {activePanel.title}</span>
          <h3>批量真实项目分析</h3>
          <p>{activePanel.lead}</p>
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
            {activePanel.id === 'launch' ? '返回修改' : '上一步'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={activePanel.id === 'launch' ? !canRun : !nextPanel}
            onClick={() => {
              if (activePanel.id === 'launch') {
                navigateScreen('run');
                return;
              }
              if (nextPanel) setConfigPanel(nextPanel.id);
            }}
          >
            {activePanel.id === 'launch' ? '准备分析' : '下一步'}
            {activePanel.id !== 'launch' ? <ArrowRight size={15} /> : <Play size={16} />}
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
          <h3>{analyzing ? '正在运行 ArkTaint 批量分析' : '运行控制'}</h3>
          <p>集中呈现任务阶段、分析产物与实时输出，便于持续掌握本次任务执行状态。</p>
        </div>
        <div className="run-hero-actions">
          <button type="button" className="secondary-button" onClick={() => navigateScreen('config')}>
            <ArrowLeft size={15} />
            回到配置
          </button>
          <button type="button" className="primary-button" disabled={!canRun} onClick={startRun}>
            <Play size={16} />
            {analyzing ? '运行中' : logs.length ? '重新运行' : '开始分析'}
          </button>
        </div>
      </section>

      <div className="run-grid">
        <section className="surface-panel runtime-panel">
          <div className="panel-heading compact">
            <span className="icon-badge"><Clock3 size={16} /></span>
            <div>
              <strong>运行状态</strong>
              <p>系统将持续更新当前阶段、项目进度、产物数量与任务状态。</p>
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
              <span>
                {runSnapshot.currentProjectIndex || 0} / {runSnapshot.currentProjectTotal || runSnapshot.selectedProjects || 0}
              </span>
            </div>
          )}
        </section>

        {runSnapshot.artifacts.length > 0 && (
          <section className="surface-panel artifact-panel">
            <div className="panel-heading compact">
              <span className="icon-badge"><FileText size={16} /></span>
              <div>
                <strong>产物</strong>
                <p>支持快速复制产物路径，便于进一步查看 summary、result 与 session 文件。</p>
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
            <p>实时展示桥接服务与分析引擎输出，便于跟踪任务执行细节。</p>
          </div>
        </div>
        <div className="terminal-feed">
          {logs.length === 0 ? (
            <div className="terminal-empty">
              <strong>尚未开始运行</strong>
              <span>任务启动后，系统将在此持续展示实时运行输出。</span>
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

      <section className="surface-panel runtime-panel result-overview-panel">
        <div className="panel-heading compact">
          <span className="icon-badge"><Workflow size={16} /></span>
          <div>
            <strong>结果预览</strong>
            <p>集中查看本次批量分析的结果摘要，并提供面向用户报告的快速预览入口。</p>
          </div>
        </div>
        <div className="runtime-grid">
          <div>
            <span>分析项目数</span>
            <strong>{runResultSummary.total}</strong>
          </div>
          <div>
            <span>完成项目数</span>
            <strong>{runResultSummary.completed}</strong>
          </div>
          <div>
            <span>失败项目数</span>
            <strong>{runResultSummary.failed}</strong>
          </div>
          <div>
            <span>报告状态</span>
            <strong>{previewArtifact ? '已生成' : '未生成'}</strong>
          </div>
        </div>
        <div className="progress-summary">
          <strong>报告预览</strong>
          <div className="report-preview-actions">
            <button
              type="button"
              className="primary-button report-preview-button"
              disabled={!previewArtifact || reportPreviewLoading}
              onClick={() => void openReportPreview()}
            >
              <FileText size={16} />
              {reportPreviewLoading ? '加载预览中' : '结果预览'}
            </button>
            <button
              type="button"
              className="secondary-button report-preview-button"
              disabled={!previewArtifact}
              onClick={downloadReport}
            >
              <FileText size={16} />
              下载报告
            </button>
          </div>
        </div>
      </section>

      {logs.length > 0 && !analyzing && (
        <section className="surface-panel run-history-note">
          <strong>上次运行</strong>
          <span>
            退出码：{runSnapshot.exitCode ?? 'unknown'} / 产物：{runSnapshot.artifacts.length} / 日志：{logs.length}
          </span>
        </section>
      )}

      {reportPreviewOpen && (
        <div className="preview-overlay" onClick={() => setReportPreviewOpen(false)}>
          <section className="preview-dialog surface-panel" onClick={event => event.stopPropagation()}>
            <div className="panel-heading compact">
              <span className="icon-badge"><FileText size={16} /></span>
              <div>
                <strong>结果预览</strong>
                <p>{previewArtifact?.path || '当前暂无可预览报告'}</p>
              </div>
            </div>
            <div className="preview-body">
              {reportPreviewLoading ? (
                <div className="preview-placeholder">正在加载报告内容...</div>
              ) : reportPreviewError ? (
                <div className="preview-placeholder preview-error">{reportPreviewError}</div>
              ) : (
                <pre data-kind={reportPreviewKind}>{reportPreviewContent || '当前报告内容为空。'}</pre>
              )}
            </div>
            <div className="config-actions">
              <button type="button" className="secondary-button" onClick={() => setReportPreviewOpen(false)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );

  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <nav className="workbench-page-tabs" aria-label="工作台页面">
          <button type="button" className={screen === 'config' ? 'active' : ''} onClick={() => navigateScreen('config')}>
            任务配置
          </button>
          <button type="button" className={screen === 'llm' ? 'active' : ''} onClick={() => navigateScreen('llm')}>
            全局能力配置
          </button>
          <button type="button" className={screen === 'run' ? 'active' : ''} onClick={() => navigateScreen('run')}>
            分析流程
          </button>
        </nav>
      </header>

      {screen === 'run' ? renderRun() : screen === 'llm' ? renderLlmConfig() : renderConfig()}
    </div>
  );
}
