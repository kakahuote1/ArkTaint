import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { ArrowRight, CheckCircle2, FileSearch, Gauge, ListChecks, ShieldCheck } from 'lucide-react';

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
      { threshold: 0.16 }
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

function ProductFlowSvg() {
  return (
    <svg className="product-flow-svg" viewBox="0 0 920 620" role="img" aria-label="ArkTaint 标准分析流程">
      <defs>
        <linearGradient id="flowBg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f8fafc" />
          <stop offset="1" stopColor="#eef7f4" />
        </linearGradient>
        <linearGradient id="flowStroke" x1="0" x2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.52" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#0f172a" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect x="24" y="24" width="872" height="572" rx="8" fill="url(#flowBg)" />
      <path className="flow-grid-line" d="M92 128 H828" />
      <path className="flow-grid-line" d="M92 262 H828" />
      <path className="flow-grid-line" d="M92 396 H828" />
      <path className="flow-grid-line" d="M180 82 V520" />
      <path className="flow-grid-line" d="M460 82 V520" />
      <path className="flow-grid-line" d="M740 82 V520" />

      <g filter="url(#softShadow)">
        <g className="flow-node" transform="translate(86 156)">
          <rect width="190" height="118" rx="8" />
          <text x="22" y="38">预分析</text>
          <text x="22" y="68" className="muted">自动识别项目入口</text>
          <text x="22" y="92" className="muted">整理候选与缺口</text>
        </g>
        <g className="flow-node center" transform="translate(364 104)">
          <rect width="190" height="118" rx="8" />
          <text x="22" y="38">LLM 建模</text>
          <text x="22" y="68" className="muted">只在需要时补语义</text>
          <text x="22" y="92" className="muted">生成可复核产物</text>
        </g>
        <g className="flow-node" transform="translate(644 156)">
          <rect width="190" height="118" rx="8" />
          <text x="22" y="38">全量分析</text>
          <text x="22" y="68" className="muted">恢复异步和回调传播</text>
          <text x="22" y="92" className="muted">输出可追踪结果</text>
        </g>
      </g>

      <path className="main-flow-path" pathLength="1" d="M276 216 C336 214 318 160 364 160" />
      <path className="main-flow-path" pathLength="1" d="M554 160 C608 160 580 216 644 216" />
      <path className="return-flow-path" pathLength="1" d="M740 286 C740 444 184 456 184 286" />

      <circle className="flow-pulse pulse-a" r="7">
        <animateMotion dur="5.2s" repeatCount="indefinite" path="M276 216 C336 214 318 160 364 160" />
      </circle>
      <circle className="flow-pulse pulse-b" r="7">
        <animateMotion dur="5.2s" begin="1.4s" repeatCount="indefinite" path="M554 160 C608 160 580 216 644 216" />
      </circle>
      <circle className="flow-pulse pulse-c" r="6">
        <animateMotion dur="7s" begin="0.7s" repeatCount="indefinite" path="M740 286 C740 444 184 456 184 286" />
      </circle>

      <g className="flow-output" transform="translate(168 390)">
        <rect width="584" height="116" rx="8" />
        <text x="28" y="42">输出给人的结果，而不是只给机器的日志</text>
        <text x="28" y="74" className="muted">summary、diagnostics、feedback、运行过程和产物路径会一起保留，方便复核和复跑。</text>
      </g>
    </svg>
  );
}

function AdvantageSvg() {
  return (
    <svg className="advantage-svg" viewBox="0 0 760 280" role="img" aria-label="ArkTaint 优势">
      <defs>
        <linearGradient id="advLine" x1="0" x2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect x="18" y="22" width="724" height="236" rx="8" />
      <path className="adv-track" d="M96 142 H664" />
      <g className="adv-step" transform="translate(76 94)">
        <circle cx="48" cy="48" r="42" />
        <text x="48" y="53">找得到</text>
      </g>
      <g className="adv-step" transform="translate(310 94)">
        <circle cx="48" cy="48" r="42" />
        <text x="48" y="53">跑得通</text>
      </g>
      <g className="adv-step" transform="translate(544 94)">
        <circle cx="48" cy="48" r="42" />
        <text x="48" y="53">看得懂</text>
      </g>
      <circle className="adv-dot" r="8">
        <animateMotion dur="4.6s" repeatCount="indefinite" path="M124 142 H358 H592" />
      </circle>
    </svg>
  );
}

const advantages = [
  {
    icon: FileSearch,
    title: '先理解项目结构，再进入风险分析',
    body: 'ArkTaint 会从项目目录出发识别源码范围、入口和候选 API，让后续分析建立在真实项目结构上。',
  },
  {
    icon: ShieldCheck,
    title: '恢复异步和回调里的传播断点',
    body: '面对 Promise、回调和声明式触发，ArkTaint 会补足断开的传播关系，让数据流结果更接近实际执行。',
  },
  {
    icon: ListChecks,
    title: '结果能追踪、能复核、能复跑',
    body: 'summary、diagnostics 和 feedback 会一起保留，方便安全人员解释结果、定位缺口并进行复查。',
  },
];

const productSteps = [
  '选择项目',
  '确认源码范围',
  '按需启用建模',
  '运行全量分析',
  '查看结果产物',
];

export default function Overview({ onStart }: OverviewProps) {
  return (
    <main className="experience-shell overview-page">
      <section className="product-hero">
        <div className="product-hero-copy">
          <span className="eyebrow">ArkTaint 静态分析工作台</span>
          <h1>让真实 ArkTS 项目的数据流风险更早暴露</h1>
          <p className="hero-paragraph">
            ArkTaint 面向 OpenHarmony / ArkTS 应用，自动梳理项目入口、异步回调和跨组件传播关系，帮助安全人员发现敏感数据从来源到风险点的真实流向，并保留可复核的过程与结果。
          </p>
          <div className="stage-actions">
            <button className="primary-button hero-action" onClick={onStart}>
              进入工作台
              <ArrowRight size={16} />
            </button>
            <a className="secondary-link" href="#product-advantages">了解产品优势</a>
          </div>
          <div className="hero-trust-row">
            <span><CheckCircle2 size={15} /> 适合真实项目</span>
            <span><Gauge size={15} /> 有预算和进度控制</span>
            <span><ShieldCheck size={15} /> 输出可复核</span>
          </div>
        </div>
        <div className="product-hero-visual" aria-hidden="true">
          <ProductFlowSvg />
        </div>
      </section>

      <RevealSection className="product-strip">
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
          <h2>ArkTaint 的目标不是多报结果，而是把真实项目里的传播关系讲清楚</h2>
          <p>
            ArkTS 项目里，数据经常穿过 Promise、回调、生命周期和声明式界面触发。ArkTaint 会把这些容易断开的传播关系恢复出来，再生成能够复核的分析产物。
          </p>
        </div>
        <div className="advantage-layout">
          <div className="advantage-visual">
            <AdvantageSvg />
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
            <h2>分析结果既能给出风险，也能说明它从哪里来</h2>
          <p>
            每次分析都会保留 summary、diagnostics、feedback 和运行日志。你可以看到风险流、候选缺口和模型补全结果，也可以据此复查项目结构或再次运行。
          </p>
        </div>
        <button className="primary-button" onClick={onStart}>
          打开分析工作台
          <ArrowRight size={16} />
        </button>
      </RevealSection>
    </main>
  );
}
