import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Gauge,
  Route,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

interface OverviewProps {
  onStart: () => void;
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
  return (
    <svg className="pipeline-svg" viewBox="0 0 980 620" role="img" aria-label="ArkTaint 标准分析链路">
      <defs>
        <linearGradient id="pipelineSurface" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f7fb" />
        </linearGradient>
        <linearGradient id="pipelineStroke" x1="0" x2="1">
          <stop offset="0" stopColor="#0f62fe" />
          <stop offset="0.55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
        <filter id="softPanelShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="22" stdDeviation="20" floodColor="#101828" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect x="28" y="28" width="924" height="564" rx="18" fill="url(#pipelineSurface)" />
      <path className="pipeline-grid-line" d="M108 132 H872" />
      <path className="pipeline-grid-line" d="M108 302 H872" />
      <path className="pipeline-grid-line" d="M108 472 H872" />
      <path className="pipeline-grid-line" d="M224 84 V536" />
      <path className="pipeline-grid-line" d="M490 84 V536" />
      <path className="pipeline-grid-line" d="M756 84 V536" />

      <g filter="url(#softPanelShadow)">
        <g className="flow-card" transform="translate(94 168)">
          <rect width="214" height="132" rx="14" />
          <text x="24" y="42">预分析</text>
          <text x="24" y="74" className="muted">识别源码范围、入口和候选 API</text>
          <text x="24" y="102" className="muted">先把真实项目结构梳理清楚</text>
        </g>
        <g className="flow-card focus" transform="translate(383 108)">
          <rect width="214" height="132" rx="14" />
          <text x="24" y="42">LLM 建模</text>
          <text x="24" y="74" className="muted">只在需要时补全未知语义</text>
          <text x="24" y="102" className="muted">模型产物可缓存、可复核</text>
        </g>
        <g className="flow-card" transform="translate(672 168)">
          <rect width="214" height="132" rx="14" />
          <text x="24" y="42">全量分析</text>
          <text x="24" y="74" className="muted">恢复异步、回调和生命周期传播</text>
          <text x="24" y="102" className="muted">输出风险流与诊断报告</text>
        </g>
      </g>

      <path className="flow-path" pathLength="1" d="M308 234 C356 234 342 174 383 174" />
      <path className="flow-path" pathLength="1" d="M597 174 C642 174 628 234 672 234" />
      <path className="return-path" pathLength="1" d="M780 324 C780 466 202 470 202 324" />

      <circle className="flow-dot dot-blue" r="7">
        <animateMotion dur="5.4s" repeatCount="indefinite" path="M308 234 C356 234 342 174 383 174" />
      </circle>
      <circle className="flow-dot dot-green" r="7">
        <animateMotion dur="5.4s" begin="1.2s" repeatCount="indefinite" path="M597 174 C642 174 628 234 672 234" />
      </circle>
      <circle className="flow-dot dot-ink" r="6">
        <animateMotion dur="7s" begin="0.5s" repeatCount="indefinite" path="M780 324 C780 466 202 470 202 324" />
      </circle>

      <g className="result-band" transform="translate(174 402)">
        <rect width="632" height="104" rx="14" />
        <text x="28" y="40">面向复核的结果，而不是只给机器看的日志</text>
        <text x="28" y="72" className="muted">summary、diagnostics、feedback、运行过程和产物路径一起保留。</text>
      </g>
    </svg>
  );
}

function ProofSvg() {
  return (
    <svg className="proof-svg" viewBox="0 0 760 290" role="img" aria-label="ArkTaint 能力优势">
      <defs>
        <linearGradient id="proofLine" x1="0" x2="1">
          <stop offset="0" stopColor="#0f62fe" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <rect x="18" y="22" width="724" height="246" rx="18" />
      <path className="proof-track" d="M108 146 H652" />
      {[
        { x: 88, label: '找得到' },
        { x: 322, label: '跑得通' },
        { x: 556, label: '看得懂' },
      ].map(item => (
        <g className="proof-step" transform={`translate(${item.x} 96)`} key={item.label}>
          <circle cx="48" cy="48" r="42" />
          <text x="48" y="54">{item.label}</text>
        </g>
      ))}
      <circle className="proof-dot" r="8">
        <animateMotion dur="4.8s" repeatCount="indefinite" path="M136 146 H370 H604" />
      </circle>
    </svg>
  );
}

const productSteps = ['选择项目', '确认源码范围', '按需建模', '运行分析', '复核结果'];

const advantages = [
  {
    icon: FileSearch,
    title: '先理解项目，再分析风险',
    body: 'ArkTaint 会先识别源码范围、入口形态和候选 API，让后续分析建立在真实项目结构上。',
  },
  {
    icon: Workflow,
    title: '覆盖真实应用里的断点',
    body: '面对 Promise、回调、生命周期和跨组件传递，ArkTaint 会恢复容易断开的数据传播关系。',
  },
  {
    icon: ShieldCheck,
    title: '结果能复核，也能复跑',
    body: '风险流、诊断信息、模型补全结果和运行日志会一起保留，便于定位问题和重新验证。',
  },
];

export default function Overview({ onStart }: OverviewProps) {
  return (
    <main className="overview-page">
      <section className="product-hero">
        <div className="product-hero-copy">
          <span className="eyebrow">ArkTS / OpenHarmony 静态分析</span>
          <h1>ArkTaint</h1>
          <p className="hero-statement">
            面向真实 ArkTS 项目的数据流风险分析平台。它把预分析、按需 LLM 建模和全量分析连成一条可运行、可观察、可复核的标准链路，帮助安全人员更早发现敏感数据从来源到风险点的真实流向。
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
      </section>

      <RevealSection className="product-strip" as="div">
        {productSteps.map((step, index) => (
          <div key={step} className="product-strip-step">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </RevealSection>

      <RevealSection className="product-advantage-section">
        <div id="product-advantages" className="section-anchor" />
        <div className="product-section-copy">
          <span className="eyebrow">产品优势</span>
          <h2>把真实项目里断开的传播关系重新连起来</h2>
          <p>
            ArkTS 项目里的数据经常穿过异步任务、声明式界面、生命周期和 SDK 回调。ArkTaint 的价值，是把这些路径放回同一条分析链路里，再把过程和结果完整交给人复核。
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

      <RevealSection className="product-output-section">
        <div className="product-section-copy compact">
          <span className="eyebrow">运行体验</span>
          <h2>每一次分析都能看到过程、状态和产物</h2>
          <p>
            工作台会固定展示当前配置、运行阶段、实时日志和最近产物。新手可以按默认路径跑通单项目，复杂项目再逐步打开建模、规则、模块和批量能力。
          </p>
        </div>
        <button className="primary-button" onClick={onStart}>
          打开工作台
          <ArrowRight size={16} />
        </button>
      </RevealSection>
    </main>
  );
}
