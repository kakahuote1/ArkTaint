import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

type TaskMode = 'single' | 'auto' | 'batch';
type LogType = 'log' | 'error' | 'sys' | 'done';
type BridgeEvent = { type?: LogType; message?: string; time?: string; code?: number | null };
type BridgeConfig = { defaultArkTaintRoot?: string; valid?: boolean; reason?: string; bridgePort?: number };
type LogEntry = { message: string; time: string; type: LogType };

const bridgeBaseUrl = import.meta.env.VITE_ARKTAINT_BRIDGE_URL || 'http://localhost:3001';
const storageKey = 'arktaint.console.settings.v5';

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

function getLogClass(log: LogEntry) {
  const msg = log.message.toLowerCase();
  if (log.type === 'error' || msg.includes('error') || msg.includes('fail') || msg.includes('timeout') || msg.includes('parse_error')) return 'log-error';
  if (msg.includes('warn') || msg.includes('need-human-check') || msg.includes('unresolved') || msg.includes('partial')) return 'log-warn';
  if (log.type === 'done' || msg.includes(' done') || msg.includes('complete') || msg.includes('summary_json')) return 'log-success';
  return 'log-info';
}

function inferStep(message: string, current: number) {
  const msg = message.toLowerCase();
  if (msg.includes('summary_json') || msg.includes('batch_done') || msg.includes('final_summary')) return Math.max(current, 4);
  if (msg.includes('semanticflow') || msg.includes('llm') || msg.includes('auto_model') || msg.includes('parse_')) return Math.max(current, 3);
  if (msg.includes('build_scene') || msg.includes('pag') || msg.includes('final_analyze') || msg.includes('project_split')) return Math.max(current, 2);
  return Math.max(current, 1);
}

function FieldHelp({ children }: { children: ReactNode }) {
  return <div className="field-help">{children}</div>;
}

function Toggle({ checked, onChange, children, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-line ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function cleanLines(value: string) {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

export default function Console() {
  const saved = useMemo(readSaved, []);
  const readText = (key: string, fallback = '') => typeof saved[key] === 'string' ? String(saved[key]) : fallback;
  const readBool = (key: string, fallback: boolean) => typeof saved[key] === 'boolean' ? Boolean(saved[key]) : fallback;

  const [taskMode, setTaskMode] = useState<TaskMode>((readText('taskMode', 'single') as TaskMode) || 'single');
  const [analyzing, setAnalyzing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const [arktaintRoot, setArkTaintRoot] = useState(readText('arktaintRoot'));
  const [repo, setRepo] = useState(readText('repo'));
  const [sourceDir, setSourceDir] = useState(readText('sourceDir', ''));
  const [outputDir, setOutputDir] = useState(readText('outputDir'));
  const [projectRoot, setProjectRoot] = useState(readText('projectRoot', 'D:\\cursor\\workplace\\project'));
  const [projects, setProjects] = useState(readText('projects'));

  const [profile, setProfile] = useState(readText('profile', 'default'));
  const [reportMode, setReportMode] = useState(readText('reportMode', 'light'));
  const [entryModel, setEntryModel] = useState(readText('entryModel', 'arkMain'));
  const [maxEntries, setMaxEntries] = useState(readText('maxEntries', '9999'));
  const [k, setK] = useState(readText('k'));
  const [incremental, setIncremental] = useState(readBool('incremental', false));
  const [stopOnFirstFlow, setStopOnFirstFlow] = useState(readBool('stopOnFirstFlow', false));
  const [maxFlowsPerEntry, setMaxFlowsPerEntry] = useState(readText('maxFlowsPerEntry'));
  const [secondarySinkSweep, setSecondarySinkSweep] = useState(readText('secondarySinkSweep', 'auto'));

  const [llmProfile, setLlmProfile] = useState(readText('llmProfile', 'qwen'));
  const [llmModel, setLlmModel] = useState(readText('llmModel', 'qwen3-coder-next'));
  const [llmTimeoutMs, setLlmTimeoutMs] = useState(readText('llmTimeoutMs', '45000'));
  const [llmConnectTimeoutMs, setLlmConnectTimeoutMs] = useState(readText('llmConnectTimeoutMs'));
  const [llmMaxAttempts, setLlmMaxAttempts] = useState(readText('llmMaxAttempts', '1'));
  const [llmMaxFailures, setLlmMaxFailures] = useState(readText('llmMaxFailures', '3'));
  const [llmRepairAttempts, setLlmRepairAttempts] = useState(readText('llmRepairAttempts', '0'));
  const [maxLlmItems, setMaxLlmItems] = useState(readText('maxLlmItems', '4'));
  const [concurrency, setConcurrency] = useState(readText('concurrency', '1'));
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
  const [skipExisting, setSkipExisting] = useState(readBool('skipExisting', false));

  const [showAdvanced, setShowAdvanced] = useState(readBool('showAdvanced', false));
  const [kernelRule, setKernelRule] = useState(readText('kernelRule'));
  const [projectRule, setProjectRule] = useState(readText('projectRule'));
  const [candidateRule, setCandidateRule] = useState(readText('candidateRule'));
  const [modelRoot, setModelRoot] = useState(readText('modelRoot'));
  const [enableModel, setEnableModel] = useState(readText('enableModel'));
  const [disableModel, setDisableModel] = useState(readText('disableModel'));
  const [moduleSpec, setModuleSpec] = useState(readText('moduleSpec'));
  const [disableModule, setDisableModule] = useState(readText('disableModule'));
  const [arkmainSpec, setArkmainSpec] = useState(readText('arkmainSpec'));

  const isAutoMode = taskMode === 'auto';
  const isBatchMode = taskMode === 'batch';
  const needsSingleRepo = taskMode === 'single' || taskMode === 'auto';
  const canRun = Boolean(arktaintRoot.trim() && !analyzing && (isBatchMode ? projectRoot.trim() : repo.trim()));

  const payload = useMemo(() => ({
    taskMode,
    arktaintRoot,
    repo,
    sourceDir,
    outputDir,
    projectRoot,
    projects,
    profile,
    reportMode,
    entryModel,
    maxEntries,
    k,
    incremental,
    stopOnFirstFlow,
    maxFlowsPerEntry,
    secondarySinkSweep: secondarySinkSweep === 'auto' ? '' : secondarySinkSweep === 'true',
    autoModel: isAutoMode || isBatchMode,
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
    showAdvanced,
  }), [taskMode, arktaintRoot, repo, sourceDir, outputDir, projectRoot, projects, profile, reportMode, entryModel, maxEntries, k, incremental, stopOnFirstFlow, maxFlowsPerEntry, secondarySinkSweep, isAutoMode, isBatchMode, llmProfile, llmModel, llmTimeoutMs, llmConnectTimeoutMs, llmMaxAttempts, llmMaxFailures, llmRepairAttempts, maxLlmItems, concurrency, arkMainMaxCandidates, llmSessionCacheDir, llmSessionCacheMode, publishModel, projectTimeoutSeconds, heartbeatSeconds, sourceDirMode, splitSourceDirThreshold, sourceDirTimeoutSeconds, maxSplitSourceDirs, maxProjects, skipExisting, kernelRule, projectRule, candidateRule, modelRoot, enableModel, disableModel, moduleSpec, disableModule, arkmainSpec, showAdvanced]);

  useEffect(() => {
    fetch(`${bridgeBaseUrl}/api/config`)
      .then(response => {
        if (!response.ok) throw new Error('bridge unavailable');
        return response.json();
      })
      .then((config: BridgeConfig) => {
        setBridgeConfig(config);
        setBridgeError('');
        if (!arktaintRoot && config.defaultArkTaintRoot) setArkTaintRoot(config.defaultArkTaintRoot);
      })
      .catch(() => setBridgeError('本地桥接服务未连接。请先在 arktaint-frontend 目录运行 node server.js。'));
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [payload]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const appendLog = (message: string, type: LogType = 'log', time?: string) => {
    setLogs(prev => [...prev, toLog(message, type, time)]);
    setCurrentStep(prev => inferStep(message, prev));
  };

  const handlePickFolder = async (setter: Dispatch<SetStateAction<string>>) => {
    try {
      const response = await fetch(`${bridgeBaseUrl}/api/pick-folder`);
      if (!response.ok) throw new Error('目录选择失败');
      const data = await response.json();
      if (data.path) setter(data.path);
    } catch {
      setBridgeError('目录选择器不可用。请确认本地桥接服务已经启动。');
    }
  };

  const applyPreset = (mode: TaskMode) => {
    setTaskMode(mode);
    if (mode === 'single') {
      setReportMode('light');
      setEntryModel('arkMain');
      setMaxEntries('9999');
      setMaxLlmItems('4');
    }
    if (mode === 'auto') {
      setReportMode('light');
      setEntryModel('arkMain');
      setLlmProfile(llmProfile || 'qwen');
      setLlmModel(llmModel || 'qwen3-coder-next');
      setLlmTimeoutMs('45000');
      setLlmMaxAttempts('1');
      setLlmMaxFailures('3');
      setLlmRepairAttempts('0');
      setMaxLlmItems('4');
      setConcurrency('1');
    }
    if (mode === 'batch') {
      setReportMode('light');
      setEntryModel('explicit');
      setProjectTimeoutSeconds('180');
      setHeartbeatSeconds('30');
      setSourceDirMode('auto');
      setSourceDirTimeoutSeconds('90');
      setMaxLlmItems('2');
      setConcurrency('1');
    }
  };

  const startRun = async () => {
    if (!canRun) return;
    setAnalyzing(true);
    setCurrentStep(1);
    setLogs([
      toLog(`连接本地桥接服务：${bridgeBaseUrl}`, 'sys'),
      toLog(isBatchMode ? `项目集合：${projectRoot.trim()}` : `目标项目：${repo.trim()}`, 'sys'),
    ]);

    const endpoint = isBatchMode ? '/api/batch-analyze' : '/api/analyze';
    const body = isBatchMode
      ? { ...payload, arktaintRoot: arktaintRoot.trim(), projectRoot: projectRoot.trim() }
      : { ...payload, arktaintRoot: arktaintRoot.trim(), repo: repo.trim() };

    try {
      const response = await fetch(`${bridgeBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error('桥接服务没有返回流式输出。');

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
              setCurrentStep(4);
              setLogs(prev => [...prev, toLog(`引擎执行结束，退出码：${data.code ?? 'unknown'}`, 'done', data.time)]);
            } else if (data.message) {
              appendLog(data.message, data.type || 'log', data.time);
            }
          } catch (error) {
            appendLog(`无法解析桥接事件：${String(error)}`, 'error');
          }
        }
      }
    } catch (error) {
      appendLog(`桥接通信失败：${String(error)}`, 'error');
      setAnalyzing(false);
    }
  };

  const sourceDirCount = cleanLines(sourceDir).length;
  const projectCount = cleanLines(projects).join(',').split(',').map(item => item.trim()).filter(Boolean).length;

  if (analyzing || currentStep > 0) {
    return (
      <main className="console-page console-modern">
        <header className="workbench-head compact">
          <div>
            <span className="eyebrow">运行状态</span>
            <h1>ArkTaint 正在执行</h1>
            <p>控制台只展示关键阶段和引擎输出。结果文件仍写入 ArkTaint 的输出目录，便于后续复核。</p>
          </div>
          {!analyzing && <button className="btn btn-secondary" onClick={() => { setCurrentStep(0); setLogs([]); }}>返回配置</button>}
        </header>
        <section className="run-board">
          <aside className="run-rail">
            {[
              ['连接', '校验工程与桥接服务'],
              ['建图', '发现源码目录并构建分析图'],
              ['建模', '按需运行 SemanticFlow'],
              ['报告', '写出摘要、诊断与流结果'],
            ].map(([title, desc], index) => {
              const step = index + 1;
              return (
                <div key={title} className={`run-step ${currentStep > step ? 'done' : currentStep === step ? 'active' : ''}`}>
                  <span>{step}</span>
                  <div><strong>{title}</strong><p>{desc}</p></div>
                </div>
              );
            })}
          </aside>
          <section className="terminal-panel">
            {logs.map((log, index) => (
              <div key={`${log.time}-${index}`} className="log-line">
                <span className="log-time">[{log.time}]</span>
                <span className={getLogClass(log)}>{log.message}</span>
              </div>
            ))}
            {analyzing && <div className="terminal-caret">等待下一条输出</div>}
            <div ref={terminalEndRef} />
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="console-page console-modern">
      <header className="workbench-head">
        <div>
          <span className="eyebrow">分析控制台</span>
          <h1>选择一条路径，然后运行 ArkTaint</h1>
          <p>普通项目只需要目标目录；需要未知 API 建模时打开 SemanticFlow；批量验证真实项目时使用项目集合模式。</p>
        </div>
      </header>

      {(bridgeError || bridgeConfig) && (
        <div className={`bridge-banner ${bridgeError ? 'error' : bridgeConfig?.valid ? 'ok' : 'warn'}`}>
          {bridgeError || `本地桥接服务已连接，默认 ArkTaint 根目录：${bridgeConfig?.defaultArkTaintRoot || '-'}`}
        </div>
      )}

      <section className="task-strip">
        <button className={`task-choice ${taskMode === 'single' ? 'active' : ''}`} onClick={() => applyPreset('single')}>
          <strong>普通分析</strong><span>最快开始，适合先确认项目能否跑通。</span>
        </button>
        <button className={`task-choice ${taskMode === 'auto' ? 'active' : ''}`} onClick={() => applyPreset('auto')}>
          <strong>LLM 自动建模</strong><span>先识别未知 API，再把产物注入完整分析。</span>
        </button>
        <button className={`task-choice ${taskMode === 'batch' ? 'active' : ''}`} onClick={() => applyPreset('batch')}>
          <strong>真实项目批量</strong><span>带超时、分片和记录，适合多项目验证。</span>
        </button>
      </section>

      <section className="workbench-layout">
        <div className="workbench-main">
          <section className="work-panel primary">
            <div className="panel-title"><span>01</span><div><h2>目标</h2><p>只填必要路径即可开始。源码目录留空时，后端会自动发现 ArkTS 目录。</p></div></div>
            <div className="form-grid">
              <label className="field wide"><span>ArkTaint 根目录</span><div className="path-row"><input value={arktaintRoot} onChange={e => setArkTaintRoot(e.target.value)} placeholder="D:\\cursor\\workplace\\ArkTaint" /><button className="btn btn-secondary" onClick={() => handlePickFolder(setArkTaintRoot)}>选择</button></div></label>
              {needsSingleRepo ? (
                <>
                  <label className="field wide"><span>目标项目目录</span><div className="path-row"><input value={repo} onChange={e => setRepo(e.target.value)} placeholder="D:\\cursor\\workplace\\project\\HarmonyStudy" /><button className="btn btn-secondary" onClick={() => handlePickFolder(setRepo)}>选择</button></div></label>
                  <label className="field wide"><span>ArkTS 源码目录（可选）</span><textarea value={sourceDir} onChange={e => setSourceDir(e.target.value)} placeholder="留空自动发现；如需指定可填 entry/src/main/ets，多目录换行" /><FieldHelp>留空是推荐用法。只有项目结构特殊或需要限制范围时再填写。</FieldHelp></label>
                </>
              ) : (
                <>
                  <label className="field wide"><span>项目集合目录</span><div className="path-row"><input value={projectRoot} onChange={e => setProjectRoot(e.target.value)} placeholder="D:\\cursor\\workplace\\project" /><button className="btn btn-secondary" onClick={() => handlePickFolder(setProjectRoot)}>选择</button></div></label>
                  <label className="field wide"><span>项目名称（可选）</span><textarea value={projects} onChange={e => setProjects(e.target.value)} placeholder="留空表示扫描集合目录；指定多个项目可用换行或逗号分隔" /><FieldHelp>批量模式会为每个项目单独落盘记录，避免重复工作和不可复核的长运行。</FieldHelp></label>
                </>
              )}
              <label className="field wide"><span>输出目录（可选）</span><div className="path-row"><input value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="留空使用 ArkTaint 默认输出目录" /><button className="btn btn-secondary" onClick={() => handlePickFolder(setOutputDir)}>选择</button></div></label>
            </div>
          </section>

          <section className="work-panel">
            <div className="panel-title"><span>02</span><div><h2>运行配置</h2><p>默认值面向真实项目稳定运行；大项目优先用 explicit 入口模型或批量分片。</p></div></div>
            <div className="advanced-form-grid">
              <label className="field"><span>报告模式</span><select value={reportMode} onChange={e => setReportMode(e.target.value)}><option value="light">轻量</option><option value="full">完整</option></select></label>
              <label className="field"><span>入口模型</span><select value={entryModel} onChange={e => setEntryModel(e.target.value)}><option value="arkMain">ArkMain</option><option value="explicit">显式入口</option></select></label>
              <label className="field"><span>分析档位</span><select value={profile} onChange={e => setProfile(e.target.value)}><option value="default">标准</option><option value="fast">快速</option><option value="strict">严格</option></select></label>
              <label className="field"><span>最大入口数</span><input value={maxEntries} onChange={e => setMaxEntries(e.target.value)} placeholder="9999" /></label>
              <label className="field"><span>上下文深度</span><input value={k} onChange={e => setK(e.target.value)} placeholder="留空使用默认" /></label>
              <label className="field"><span>每入口最大流数</span><input value={maxFlowsPerEntry} onChange={e => setMaxFlowsPerEntry(e.target.value)} placeholder="留空不限制" /></label>
              <label className="field"><span>二次汇点扫描</span><select value={secondarySinkSweep} onChange={e => setSecondarySinkSweep(e.target.value)}><option value="auto">按策略默认</option><option value="true">启用</option><option value="false">关闭</option></select></label>
              <Toggle checked={incremental} onChange={setIncremental}>使用增量缓存</Toggle>
              <Toggle checked={stopOnFirstFlow} onChange={setStopOnFirstFlow}>发现首条流后停止当前入口</Toggle>
            </div>
          </section>

          {(isAutoMode || isBatchMode) && (
            <section className="work-panel">
              <div className="panel-title"><span>03</span><div><h2>SemanticFlow</h2><p>用于未知 API 与项目语义建模。默认采用保守参数，避免 LLM 长时间阻塞。</p></div></div>
              <div className="advanced-form-grid">
                <label className="field"><span>LLM 配置名</span><input value={llmProfile} onChange={e => setLlmProfile(e.target.value)} placeholder="qwen" /></label>
                <label className="field"><span>模型覆盖</span><input value={llmModel} onChange={e => setLlmModel(e.target.value)} placeholder="qwen3-coder-next" /></label>
                <label className="field"><span>单次请求超时 ms</span><input value={llmTimeoutMs} onChange={e => setLlmTimeoutMs(e.target.value)} /></label>
                <label className="field"><span>连接超时 ms</span><input value={llmConnectTimeoutMs} onChange={e => setLlmConnectTimeoutMs(e.target.value)} placeholder="留空使用 profile" /></label>
                <label className="field"><span>单项尝试次数</span><input value={llmMaxAttempts} onChange={e => setLlmMaxAttempts(e.target.value)} /></label>
                <label className="field"><span>连续失败阈值</span><input value={llmMaxFailures} onChange={e => setLlmMaxFailures(e.target.value)} /></label>
                <label className="field"><span>JSON 修复次数</span><input value={llmRepairAttempts} onChange={e => setLlmRepairAttempts(e.target.value)} /></label>
                <label className="field"><span>每目录 LLM 项数</span><input value={maxLlmItems} onChange={e => setMaxLlmItems(e.target.value)} /></label>
                <label className="field"><span>LLM 并发</span><input value={concurrency} onChange={e => setConcurrency(e.target.value)} /></label>
                <label className="field"><span>ArkMain 候选上限</span><input value={arkMainMaxCandidates} onChange={e => setArkMainMaxCandidates(e.target.value)} placeholder="留空使用默认" /></label>
                <label className="field"><span>会话缓存模式</span><select value={llmSessionCacheMode} onChange={e => setLlmSessionCacheMode(e.target.value)}><option value="rw">读写</option><option value="read">只读</option><option value="write">只写</option><option value="off">关闭</option></select></label>
                <label className="field"><span>发布模型产物</span><input value={publishModel} onChange={e => setPublishModel(e.target.value)} placeholder="可选 pack id" /></label>
                <label className="field wide"><span>会话缓存目录</span><input value={llmSessionCacheDir} onChange={e => setLlmSessionCacheDir(e.target.value)} placeholder="可选" /></label>
              </div>
            </section>
          )}

          {isBatchMode && (
            <section className="work-panel">
              <div className="panel-title"><span>04</span><div><h2>批量控制</h2><p>每个项目和每个分片都有硬时限。样例合集会自动分片，避免拖死整轮。</p></div></div>
              <div className="advanced-form-grid">
                <label className="field"><span>项目超时秒</span><input value={projectTimeoutSeconds} onChange={e => setProjectTimeoutSeconds(e.target.value)} /></label>
                <label className="field"><span>心跳间隔秒</span><input value={heartbeatSeconds} onChange={e => setHeartbeatSeconds(e.target.value)} /></label>
                <label className="field"><span>SourceDir 模式</span><select value={sourceDirMode} onChange={e => setSourceDirMode(e.target.value)}><option value="auto">自动</option><option value="project">整项目</option><option value="split">强制分片</option></select></label>
                <label className="field"><span>自动分片阈值</span><input value={splitSourceDirThreshold} onChange={e => setSplitSourceDirThreshold(e.target.value)} /></label>
                <label className="field"><span>分片超时秒</span><input value={sourceDirTimeoutSeconds} onChange={e => setSourceDirTimeoutSeconds(e.target.value)} /></label>
                <label className="field"><span>最多分片数</span><input value={maxSplitSourceDirs} onChange={e => setMaxSplitSourceDirs(e.target.value)} placeholder="0 表示全部" /></label>
                <label className="field"><span>最多项目数</span><input value={maxProjects} onChange={e => setMaxProjects(e.target.value)} placeholder="留空不限制" /></label>
                <Toggle checked={skipExisting} onChange={setSkipExisting}>已有 summary 时跳过</Toggle>
              </div>
            </section>
          )}

          <section className="work-panel advanced-panel">
            <div className="panel-title"><span>{isBatchMode ? '05' : (isAutoMode ? '04' : '03')}</span><div><h2>高级输入</h2><p>仅在已有自定义规则、模型包或模块规约时填写。日常使用可以保持折叠。</p></div></div>
            <button className="btn btn-secondary" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? '收起高级输入' : '展开高级输入'}</button>
            {showAdvanced && (
              <div className="advanced-form-grid advanced-spaced">
                <label className="field"><span>内核规则</span><input value={kernelRule} onChange={e => setKernelRule(e.target.value)} /></label>
                <label className="field"><span>项目规则</span><input value={projectRule} onChange={e => setProjectRule(e.target.value)} /></label>
                <label className="field"><span>候选规则</span><input value={candidateRule} onChange={e => setCandidateRule(e.target.value)} /></label>
                <label className="field"><span>启用模型包</span><input value={enableModel} onChange={e => setEnableModel(e.target.value)} /></label>
                <label className="field"><span>禁用模型包</span><input value={disableModel} onChange={e => setDisableModel(e.target.value)} /></label>
                <label className="field"><span>禁用模块</span><input value={disableModule} onChange={e => setDisableModule(e.target.value)} /></label>
                <label className="field wide"><span>模型根目录</span><textarea value={modelRoot} onChange={e => setModelRoot(e.target.value)} /></label>
                <label className="field wide"><span>模块规约文件</span><textarea value={moduleSpec} onChange={e => setModuleSpec(e.target.value)} /></label>
                <label className="field wide"><span>ArkMain 规约文件</span><textarea value={arkmainSpec} onChange={e => setArkmainSpec(e.target.value)} /></label>
              </div>
            )}
          </section>
        </div>

        <aside className="launch-sidebar">
          <div className="summary-card">
            <span className="eyebrow">当前任务</span>
            <h2>{taskMode === 'single' ? '普通分析' : taskMode === 'auto' ? 'LLM 自动建模' : '真实项目批量'}</h2>
            <dl>
              <div><dt>范围</dt><dd>{isBatchMode ? (projectRoot || '未选择') : (repo || '未选择')}</dd></div>
              <div><dt>源码目录</dt><dd>{sourceDirCount > 0 ? `${sourceDirCount} 个手动指定` : '自动发现'}</dd></div>
              <div><dt>入口模型</dt><dd>{entryModel}</dd></div>
              <div><dt>LLM</dt><dd>{isAutoMode || isBatchMode ? `${llmProfile}/${llmModel || 'profile 默认'}` : '关闭'}</dd></div>
              {isBatchMode && <div><dt>项目数</dt><dd>{projectCount > 0 ? `${projectCount} 个指定` : '自动扫描'}</dd></div>}
            </dl>
            <button className="btn btn-primary" disabled={!canRun} onClick={startRun}>{canRun ? '开始执行' : '请补全必要路径'}</button>
            <p>推荐先用普通分析确认项目能跑通，再根据未知 API 情况启用 LLM 自动建模。</p>
          </div>
        </aside>
      </section>
    </main>
  );
}