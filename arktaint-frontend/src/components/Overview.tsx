import { Fragment, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  BrainCircuit,
  ChartNetwork,
  CheckCircle2,
  ChevronDown,
  CodeXml,
  FileOutput,
  FileSearch,
  FolderOpen,
  Gauge,
  Route,
  ScrollText,
  ShieldCheck,
  WandSparkles,
  Waypoints,
  Workflow,
  ScanSearch,
} from 'lucide-react';

interface OverviewProps {
  onStart: () => void;
}

type ProductStepKind = 'intake' | 'preanalysis' | 'modeling' | 'analysis' | 'delivery';

interface ProductStepItem {
  kind: ProductStepKind;
  title: string;
  note: string;
  featured?: boolean;
}

function useReveal() {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          target.classList.add('is-visible');
        }
      },
      { threshold: 0.18 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return ref;
}

function RevealSection({
  as: Tag = 'section',
  className,
  children,
}: {
  as?: 'section' | 'div';
  className?: string;
  children: ReactNode;
}) {
  const ref = useReveal();
  if (Tag === 'div') {
    return (
      <div ref={ref as RefObject<HTMLDivElement>} className={`reveal-block ${className || ''}`}>
        {children}
      </div>
    );
  }
  return (
    <section ref={ref as RefObject<HTMLElement>} className={`reveal-block ${className || ''}`}>
      {children}
    </section>
  );
}

function PipelineSvg() {
  const centerX = 560;
  const centerY = 350;
  const haloRadius = 246;
  const outerRing = 242;
  const innerRing = 186;
  const centerRadius = 172;

  const features = [
    {
      key: 'structure',
      x: 560,
      y: 78,
      width: 220,
      label: '理解项目结构',
      line: 'M560 178 L560 106',
      dotX: 560,
      dotY: 142,
    },
    {
      key: 'flow',
      x: 864,
      y: 206,
      width: 236,
      label: '识别关键数据流',
      line: 'M716 276 L746 206',
      dotX: 731,
      dotY: 241,
    },
    {
      key: 'semantic',
      x: 864,
      y: 494,
      width: 244,
      label: '补充复杂代码语义',
      line: 'M716 424 L742 494',
      dotX: 729,
      dotY: 459,
    },
    {
      key: 'risk',
      x: 560,
      y: 622,
      width: 220,
      label: '快速定位风险',
      line: 'M560 522 L560 594',
      dotX: 560,
      dotY: 558,
    },
    {
      key: 'path',
      x: 256,
      y: 494,
      width: 220,
      label: '看清传播过程',
      line: 'M404 424 L366 494',
      dotX: 385,
      dotY: 459,
    },
    {
      key: 'review',
      x: 256,
      y: 206,
      width: 220,
      label: '支持人工复核',
      line: 'M404 276 L366 206',
      dotX: 385,
      dotY: 241,
    },
  ];

  return (
    <svg className="pipeline-svg" viewBox="0 0 1120 700" role="img" aria-label="ArkTaint 产品能力展示">
      <defs>
        <linearGradient id="pipelineSurface" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f1f5f9" />
        </linearGradient>
        <radialGradient id="centerHalo" cx="50%" cy="50%" r="58%">
          <stop offset="0%" stopColor="#e0f2fe" stopOpacity="0.95" />
          <stop offset="75%" stopColor="#e0f2fe" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="centerOrbFill" cx="50%" cy="38%" r="68%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef6fb" />
        </radialGradient>
        <filter id="softPanelShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="16" floodColor="#0f172a" floodOpacity="0.08" />
        </filter>
      </defs>

      <rect className="pipeline-shell" x="34" y="34" width="1052" height="632" rx="28" fill="url(#pipelineSurface)" />
      <rect className="pipeline-shell-outline" x="34" y="34" width="1052" height="632" rx="28" />

      <circle cx={centerX} cy={centerY} r={haloRadius} fill="url(#centerHalo)" />
      <circle className="orbit-ring" cx={centerX} cy={centerY} r={outerRing} />
      <circle className="orbit-ring inner" cx={centerX} cy={centerY} r={innerRing} />

      <g className="orbit-center" filter="url(#softPanelShadow)">
        <circle cx={centerX} cy={centerY} r={centerRadius} fill="url(#centerOrbFill)" />
        <circle cx={centerX} cy={centerY} r={centerRadius} className="orbit-center-outline" />
        <text className="orbit-center-eyebrow" x={centerX} y="286">ArkTaint</text>
        <text className="orbit-center-title" x={centerX} y="324">
          <tspan x={centerX} dy="0">让隐藏的风险路径</tspan>
          <tspan className="orbit-center-emphasis" x={centerX} dy="40">真正显现</tspan>
        </text>
        <text className="orbit-center-note" x={centerX} y="402">
          <tspan x={centerX} dy="0">让复杂代码中的风险传播更清晰、更可追踪，</tspan>
          <tspan x={centerX} dy="24">也更便于人工复核</tspan>
        </text>
      </g>

      {features.map((item, index) => (
        <g key={item.key} className={`orbit-feature orbit-feature-${index + 1}`} filter="url(#softPanelShadow)">
          <path className="orbit-spoke" d={item.line} />
          <circle className="orbit-spoke-dot" cx={item.dotX} cy={item.dotY} r="6" />
          <g transform={`translate(${item.x - item.width / 2} ${item.y - 28})`}>
            <rect width={item.width} height="56" rx="18" />
            <text x={item.width / 2} y="35">{item.label}</text>
          </g>
        </g>
      ))}
    </svg>
  );
}

function ProofSvg() {
  return (
    <svg className="proof-svg" viewBox="0 0 860 320" role="img" aria-label="ArkTaint 优势对照">
      <defs>
        <linearGradient id="compareGoodLine" x1="0" x2="1">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
        <linearGradient id="compareBadLine" x1="0" x2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#cbd5e1" />
        </linearGradient>
      </defs>

      <rect className="compare-shell" x="18" y="18" width="824" height="284" rx="22" />
      <rect className="compare-panel compare-panel-left" x="50" y="118" width="330" height="144" rx="22" />
      <rect className="compare-panel compare-panel-right" x="480" y="118" width="330" height="144" rx="22" />
      <path className="compare-divider-line" d="M430 132 V248" />

      <g className="compare-divider-copy">
        <path d="M404 184 H444 L444 170 L466 192 L444 214 L444 200 H404 Z" />
        <path className="compare-divider-copy-glow" d="M404 184 H444 L444 170 L466 192 L444 214 L444 200 H404 Z" />
      </g>

      <g className="compare-side">
        <text className="compare-title muted" x="198" y="72">常规分析</text>
        <text className="compare-subtitle muted" x="198" y="98">路径信息不完整，传播过程不清晰</text>

        <circle className="compare-dot compare-dot-muted active" cx="96" cy="160" r="9" />
        <circle className="compare-dot compare-dot-muted weak" cx="96" cy="214" r="9" />

        <circle className="compare-dot compare-dot-muted active" cx="198" cy="142" r="9" />
        <circle className="compare-dot compare-dot-muted weak" cx="198" cy="187" r="9" />
        <circle className="compare-dot compare-dot-muted active" cx="198" cy="232" r="9" />

        <circle className="compare-dot compare-dot-muted active" cx="300" cy="160" r="9" />
        <circle className="compare-dot compare-dot-muted weak" cx="300" cy="214" r="9" />

        <path className="compare-path-bad" d="M105 160 L189 142" />
        <path className="compare-path-bad broken" d="M207 142 L291 160" />
        <path className="compare-path-bad broken" d="M105 214 L189 232" />
        <path className="compare-path-bad" d="M207 232 L291 214" />
        <text className="compare-footnote muted" x="198" y="282">断裂 · 分散 · 难复核</text>
      </g>

      <g className="compare-side">
        <text className="compare-title good" x="662" y="72">ArkTaint</text>
        <text className="compare-subtitle good" x="662" y="98">路径完整可见，结果清晰可复核</text>

        <circle className="compare-dot compare-dot-good active" cx="560" cy="160" r="9" />
        <circle className="compare-dot compare-dot-good active" cx="560" cy="214" r="9" />

        <circle className="compare-dot compare-dot-good active" cx="662" cy="142" r="9" />
        <circle className="compare-dot compare-dot-good weak" cx="662" cy="187" r="9" />
        <circle className="compare-dot compare-dot-good active" cx="662" cy="232" r="9" />

        <circle className="compare-dot compare-dot-good active" cx="764" cy="160" r="9" />
        <circle className="compare-dot compare-dot-good active" cx="764" cy="214" r="9" />

        <path className="compare-path-good" d="M569 160 L653 142" />
        <path className="compare-path-good" d="M671 142 L755 160" />
        <path className="compare-path-good" d="M569 214 L653 232" />
        <path className="compare-path-good" d="M671 232 L755 214" />
        <text className="compare-footnote good" x="662" y="282">完整 · 连续 · 可复核</text>
      </g>
    </svg>
  );
}

function ProductStepIcon({ kind }: { kind: ProductStepKind }) {
  if (kind === 'intake') {
    return (
      <div className="step-icon-cluster step-icon-intake" aria-label="项目接入">
        <FolderOpen className="step-icon icon-primary" strokeWidth={2.1} />
        <CodeXml className="step-icon icon-secondary" strokeWidth={2} />
      </div>
    );
  }

  if (kind === 'preanalysis') {
    return (
      <div className="step-icon-cluster step-icon-preanalysis" aria-label="预分析">
        <ChartNetwork className="step-icon icon-secondary" strokeWidth={2} />
        <ScanSearch className="step-icon icon-primary" strokeWidth={2.1} />
      </div>
    );
  }

  if (kind === 'modeling') {
    return (
      <div className="step-icon-cluster step-icon-modeling" aria-label="语义建模">
        <Blocks className="step-icon icon-secondary" strokeWidth={2} />
        <BrainCircuit className="step-icon icon-primary" strokeWidth={2.05} />
        <WandSparkles className="step-icon icon-accent" strokeWidth={2} />
      </div>
    );
  }

  if (kind === 'analysis') {
    return (
      <div className="step-icon-cluster step-icon-analysis" aria-label="全量分析">
        <Workflow className="step-icon icon-secondary" strokeWidth={2} />
        <Waypoints className="step-icon icon-primary" strokeWidth={2.05} />
        <Route className="step-icon icon-accent" strokeWidth={2} />
      </div>
    );
  }

  return (
    <div className="step-icon-cluster step-icon-delivery" aria-label="结果交付">
      <ScrollText className="step-icon icon-secondary" strokeWidth={2} />
      <FileOutput className="step-icon icon-primary" strokeWidth={2.05} />
      <BadgeCheck className="step-icon icon-accent" strokeWidth={2} />
    </div>
  );
}

const productSteps: ProductStepItem[] = [
  {
    kind: 'intake',
    title: '项目接入',
    note: '导入 ArkTS / HarmonyOS 项目与源码范围，并确认分析输入边界。',
  },
  {
    kind: 'preanalysis',
    title: '预分析',
    note: '识别入口、调用面、候选 API 与上下文，为后续求解建立基础视图。',
  },
  {
    kind: 'modeling',
    title: '语义建模',
    note: '按需补全未知 API，沉淀可复用模型资产，持续提升分析覆盖率。',
    featured: true,
  },
  {
    kind: 'analysis',
    title: '全量分析',
    note: '恢复回调、异步、生命周期与跨组件传播，定位真实风险流向。',
    featured: true,
  },
  {
    kind: 'delivery',
    title: '结果交付',
    note: '输出风险流、路径证据、诊断与分析报告，便于复核与迭代。',
  },
];

const advantages = [
  {
    icon: FileSearch,
    title: '贴近真实项目结构',
    body: 'ArkTaint 从项目源码、模块组织、接口调用和业务封装出发开展分析，更适合处理真实项目中的复杂代码结构，降低脱离业务上下文的判断偏差。',
  },
  {
    icon: Workflow,
    title: '覆盖复杂传播场景',
    body: '针对异步调用、回调逻辑、状态传递、组件交互等常见复杂场景，ArkTaint 能够识别分散在不同位置的数据传播关系，帮助团队看清风险是如何在代码中逐步形成的。',
  },
  {
    icon: ShieldCheck,
    title: '结果清晰，便于复核',
    body: 'ArkTaint 输出的不只是风险提示，还包括对应的传播路径和定位依据，方便安全、研发和审核角色在统一视角下理解结果，提升后续确认和治理效率。',
  },
];

export default function Overview({ onStart }: OverviewProps) {
  return (
    <main className="overview-page">
      <section className="product-hero">
        <div className="product-hero-copy">
          <span className="eyebrow">ArkTS / OpenHarmony 静态分析</span>
          <h1>ArkTaint</h1>
          <p className="hero-tagline">Taint Analysis Engine</p>
          <p className="hero-statement">
            ArkTaint 面向 ArkTS / HarmonyOS 真实业务项目，具备从项目结构理解、复杂传播关系识别到风险路径定位的一体化数据流风险分析能力，能够帮助团队更早发现隐藏在源码中的敏感数据传播路径，并以清晰、可追踪、可复核的方式完成风险确认与持续治理。
          </p>
          <div className="hero-actions">
            <button className="primary-button hero-action" onClick={onStart}>
              进入分析工作台
              <ArrowRight size={16} />
            </button>
            <a className="secondary-link" href="#product-advantages">了解产品优势</a>
          </div>
          <div className="hero-proof-row">
            <span><CheckCircle2 size={15} /> 适合真实项目</span>
            <span><Gauge size={15} /> 可控预算与进度</span>
            <span><Route size={15} /> 输出可追踪</span>
          </div>
        </div>
        <div className="product-hero-visual" aria-hidden="true">
          <PipelineSvg />
        </div>

        <a className="scroll-cue" href="#product-details" aria-label="向下滚动查看详情">
          <span className="scroll-cue-text">向下滚动查看详情</span>
          <span className="scroll-cue-icon">
            <ChevronDown size={18} />
          </span>
        </a>
      </section>

      <div className="section-divider" />
      <div id="product-details" className="product-strip-section">
        <div className="workflow-section">
          <div className="product-section-copy workflow-copy">
            <span className="eyebrow">工作流程</span>
            <h2>流程清晰，推进自然</h2>
            <p>
              ArkTaint把复杂分析整理成清楚阶段，每一步都衔接自然，方便用户快速上手，也便于在真实项目中持续推进，让分析过程更顺畅，结果更容易落地。
            </p>
          </div>
        </div>
        <RevealSection className="product-strip" as="div">
          {productSteps.map((step, index) => (
            <Fragment key={step.title}>
              <article className={`product-strip-step ${step.featured ? 'featured' : ''}`}>
                <div className="step-number">{String(index + 1).padStart(2, '0')}</div>
                <h3 className="step-title">{step.title}</h3>
                <div className="step-visual-shell">
                  <ProductStepIcon kind={step.kind} />
                </div>
                <p className="step-desc">{step.note}</p>
              </article>
              {index < productSteps.length - 1 ? (
                <span className="step-arrow-link" aria-hidden="true">
                  <svg viewBox="0 0 56 24" className="step-arrow-svg">
                    <path d="M4 12h38" />
                    <path d="m34 5 12 7-12 7" />
                  </svg>
                </span>
              ) : null}
            </Fragment>
          ))}
        </RevealSection>
      </div>
      <div className="section-divider" />

      <RevealSection className="product-advantage-section">
        <div id="product-advantages" className="section-anchor" />
        <div className="product-section-copy">
          <span className="eyebrow">产品优势</span>
          <h2>适配真实 ArkTS 项目场景的风险分析能力</h2>
          <p>
            ArkTaint 面向 ArkTS / HarmonyOS 项目的实际开发方式构建，支持在真实工程上下文中识别敏感数据传播关系。基于真实工程上下文还原完整路径，帮助团队更准确地理解问题、定位问题和确认问题。
          </p>
        </div>

        <div className="advantage-layout">
          <div className="advantage-visual" aria-hidden="true">
            <ProofSvg />
          </div>
          <div className="advantage-list">
            {advantages.map(item => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="advantage-item">
                  <span><Icon size={18} /></span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </RevealSection>

      <div className="section-divider" />
      <div className="product-output-bg">
        <RevealSection className="product-output-section">
          <div className="product-section-copy compact">
            <span className="eyebrow">运行体验</span>
            <h2>每一次分析都能看到过程、状态和产物</h2>
            <p>
              在ArkTaint里，任务模式、分析参数、运行阶段、实时输出和产物路径都会在任务台中连续展示。新手也能轻松上手，你可以先选项目、确定范围，按默认方式直接开始，再逐步调整策略、建模和扩展能力。
            </p>
          </div>
          <button className="primary-button" onClick={onStart}>
            打开工作台
            <ArrowRight size={16} />
          </button>
        </RevealSection>
      </div>
    </main>
  );
}
