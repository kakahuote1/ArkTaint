import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

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
      { threshold: 0.12 }
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

function PipelinePoster() {
  return (
    <svg className="poster-diagram" viewBox="0 0 760 520" role="img" aria-label="ArkTaint 分析链路">
      <defs>
        <linearGradient id="posterLine" x1="0" x2="1">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <marker id="posterArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10z" fill="#1d4ed8" />
        </marker>
      </defs>

      <rect x="28" y="26" width="704" height="468" rx="30" />

      <g className="poster-grid">
        <path d="M88 98 H672" />
        <path d="M88 194 H672" />
        <path d="M88 290 H672" />
        <path d="M88 386 H672" />
        <path d="M88 98 V386" />
        <path d="M204 98 V386" />
        <path d="M320 98 V386" />
        <path d="M436 98 V386" />
        <path d="M552 98 V386" />
        <path d="M668 98 V386" />
      </g>

      <g className="poster-node" transform="translate(96 118)">
        <rect width="128" height="64" rx="18" />
        <text x="20" y="28">源码目录</text>
        <text x="20" y="48" className="muted">自动发现 / 手动限定</text>
      </g>

      <g className="poster-node" transform="translate(256 118)">
        <rect width="128" height="64" rx="18" />
        <text x="20" y="28">场景构建</text>
        <text x="20" y="48" className="muted">入口与调用关系</text>
      </g>

      <g className="poster-node" transform="translate(416 118)">
        <rect width="128" height="64" rx="18" />
        <text x="20" y="28">规则 / 模型</text>
        <text x="20" y="48" className="muted">规则、模型、插件</text>
      </g>

      <g className="poster-node strong" transform="translate(576 118)">
        <rect width="128" height="64" rx="18" />
        <text x="20" y="28">UDE</text>
        <text x="20" y="48" className="muted">统一延后执行恢复</text>
      </g>

      <g className="poster-node" transform="translate(168 310)">
        <rect width="128" height="64" rx="18" />
        <text x="20" y="28">PAG</text>
        <text x="20" y="48" className="muted">新增传播边注入</text>
      </g>

      <g className="poster-node" transform="translate(356 310)">
        <rect width="148" height="64" rx="18" />
        <text x="20" y="28">污点流求解</text>
        <text x="20" y="48" className="muted">路径级差分与命中</text>
      </g>

      <g className="poster-node" transform="translate(564 310)">
        <rect width="140" height="64" rx="18" />
        <text x="20" y="28">结果落盘</text>
        <text x="20" y="48" className="muted">summary / diagnostics</text>
      </g>

      <path className="poster-flow" d="M224 150 H256" markerEnd="url(#posterArrow)" />
      <path className="poster-flow" d="M384 150 H416" markerEnd="url(#posterArrow)" />
      <path className="poster-flow" d="M544 150 H576" markerEnd="url(#posterArrow)" />
      <path className="poster-flow" d="M640 182 C640 242 252 246 252 310" markerEnd="url(#posterArrow)" />
      <path className="poster-flow" d="M296 342 H356" markerEnd="url(#posterArrow)" />
      <path className="poster-flow" d="M504 342 H564" markerEnd="url(#posterArrow)" />

      <g className="poster-core" transform="translate(292 210)">
        <rect x="-56" y="-34" width="176" height="96" rx="24" />
        <path d="M32 -18 L84 10 L32 38 L-20 10 Z" />
        <circle cx="32" cy="10" r="12" />
        <text x="-24" y="86" className="muted">先恢复延后传播结构，再交给求解器</text>
      </g>
    </svg>
  );
}

function RecoveryFigure() {
  return (
    <svg className="contrast-diagram" viewBox="0 0 1040 280" role="img" aria-label="UDE 恢复效果对照">
      <defs>
        <marker id="contrastArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10z" fill="#0f172a" />
        </marker>
      </defs>
      <rect x="18" y="22" width="1004" height="236" rx="24" />
      <g className="contrast-panel" transform="translate(48 52)">
        <text x="0" y="0" className="title">未恢复 UDE</text>
        <path d="M0 80 H120" markerEnd="url(#contrastArrow)" />
        <circle cx="0" cy="80" r="10" />
        <circle cx="120" cy="80" r="10" />
        <path d="M120 80 H240" strokeDasharray="8 10" markerEnd="url(#contrastArrow)" />
        <circle cx="240" cy="80" r="10" />
        <path d="M240 80 H360" markerEnd="url(#contrastArrow)" opacity="0.22" />
        <circle cx="360" cy="80" r="10" opacity="0.22" />
        <text x="0" y="126" className="muted">回调值、Promise 结果和环境位置在边界处断开</text>
      </g>
      <g className="contrast-separator" transform="translate(520 52)">
        <circle cx="0" cy="70" r="24" />
        <text x="-18" y="76">VS</text>
      </g>
      <g className="contrast-panel positive" transform="translate(606 52)">
        <text x="0" y="0" className="title">恢复 UDE</text>
        <path d="M0 80 H120" markerEnd="url(#contrastArrow)" />
        <circle cx="0" cy="80" r="10" />
        <circle cx="120" cy="80" r="10" />
        <path d="M120 80 H240" markerEnd="url(#contrastArrow)" />
        <circle cx="240" cy="80" r="10" />
        <path d="M240 80 H360" markerEnd="url(#contrastArrow)" />
        <circle cx="360" cy="80" r="10" />
        <path d="M120 80 C160 26 210 26 240 80" className="handoff" />
        <path d="M240 80 C284 134 330 134 360 80" className="handoff" />
        <text x="0" y="126" className="muted">新增传播边不改源汇规则，只补足求解前传播结构</text>
      </g>
    </svg>
  );
}

const evidenceMetrics = [
  { value: 'Promise', label: '结算结果恢复', note: '恢复 Promise 结果与 continuation 之间的传播连接' },
  { value: '回调', label: '注册侧关联', note: '把注册点、回调值和消费点重新放回同一条传播链' },
  { value: '声明式触发', label: '界面状态联动', note: '处理组件状态、属性更新与声明式触发中的传播断点' },
  { value: '环境传递', label: '闭包与位置恢复', note: '恢复环境位置和延后执行单元之间的值交接' },
  { value: '规则与模型', label: '语义补全', note: '规则包、模型包、SemanticFlow 与插件能力可以协同接入' },
  { value: '结果产物', label: '可复核输出', note: '统一输出 summary、diagnostics、feedback 与路径差分结果' },
];

const capabilityColumns = [
  {
    title: '先恢复结构，再进入求解',
    body: 'Promise、回调、声明式触发和环境传递先被统一恢复为延后传播结构，再交给 PAG 和污点求解器消费。',
  },
  {
    title: '规则、模型与插件协同',
    body: '规则包负责源汇与传递，模型包负责语义补全，SemanticFlow 与插件负责项目侧扩展和自动建模。',
  },
  {
    title: '结果可复核',
    body: '分析结束后会同时输出 summary、diagnostics、feedback、inventory 和路径级结果，便于复核和复跑。',
  },
];

const rulePanels = [
  {
    title: '项目输入',
    body: '支持项目目录、源码目录、模型根目录和批量清单；单项目、自动建模、批量和检查模式共享同一套输入结构。',
  },
  {
    title: '分析扩展',
    body: '规则包、模型包、模块规约、ArkMain 规约、SemanticFlow 和插件能力可以按项目需要逐层接入。',
  },
  {
    title: '结果落盘',
    body: '输出目录中同时保存 summary、diagnostics、feedback、inventory 和路径级结果，便于后续复核。',
  },
];

export default function Overview({ onStart }: OverviewProps) {
  return (
    <main className="experience-shell overview-page">
      <div id="overview" className="section-anchor" />
      <section className="split-stage">
        <div className="stage-copy">
          <span className="eyebrow">面向 ArkTS / OpenHarmony 的静态污点分析平台</span>
          <h1>把延后执行恢复为可求解的传播结构</h1>
          <p className="lead">
            ArkTaint 面向真实 ArkTS 项目，统一恢复 Promise、回调、声明式触发与环境传递中的延后传播关系。
            当数据在异步边界、回调边界或声明式触发边界处断开时，ArkTaint 会把这些断点重新恢复到 PAG 与污点求解过程中。
          </p>

          <div className="stage-actions">
            <button className="primary-button" onClick={onStart}>进入分析工作台</button>
            <a className="secondary-link" href="#outputs">查看输出产物</a>
          </div>

          <div className="stage-points">
            <div>
              <strong>真实项目分析</strong>
              <span>支持项目目录、源码目录、模型根目录和批量清单，适合单项目复核和大规模批量测试。</span>
            </div>
            <div>
              <strong>统一延后执行恢复（UDE）</strong>
              <span>在求解前恢复跨 Promise、回调和声明式触发的传播连接，生成新增传播边并补足结构断点。</span>
            </div>
            <div>
              <strong>规则 / 模型协同</strong>
              <span>规则包、模型包、SemanticFlow 与插件能力可以按项目需要逐层接入，补足项目语义。</span>
            </div>
          </div>
        </div>

        <div className="stage-visual">
          <div className="poster-panel">
            <PipelinePoster />
          </div>
          <div className="visual-note">
            <strong>核心分析链</strong>
            <p>源码目录先进入场景构建，再由规则、模型和 UDE 共同补足传播结构，最后进入 PAG、路径求解和结果落盘。</p>
          </div>
        </div>
      </section>

      <RevealSection className="evidence-ribbon">
        {evidenceMetrics.map(metric => (
          <div key={metric.label} className="evidence-cell">
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            <em>{metric.note}</em>
          </div>
        ))}
      </RevealSection>

      <RevealSection className="editorial-block">
        <div className="block-heading">
          <span className="eyebrow">方法特征</span>
          <h2>ArkTaint 把传播断点恢复成结构对象，再交给后续求解器处理</h2>
          <p>
            在 ArkTS / OpenHarmony 项目里，很多数据流并不是在当前调用栈内直接闭合，而是会在未来激活的执行单元里继续传播。
            ArkTaint 把这些传播统一恢复为可求解的结构对象，再交给后续规则和求解器继续处理。
          </p>
        </div>
        <div className="capability-columns">
          {capabilityColumns.map(item => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </RevealSection>

      <RevealSection as="div" className="diagram-block">
        <RecoveryFigure />
      </RevealSection>

      <RevealSection as="section" className="editorial-block models-block">
        <div className="block-heading">
          <span className="eyebrow">输入与产物</span>
          <h2>从项目输入到结果落盘，所有关键产物都能直接复核</h2>
          <p>
            ArkTaint 的输入包括项目目录、源码目录、规则包和模型包，也包括按需启用的自动建模与插件能力；
            输出覆盖 summary、diagnostics、feedback、inventory 以及路径级差分结果。
          </p>
        </div>
        <div className="rule-panels">
          {rulePanels.map(panel => (
            <article key={panel.title}>
              <h3>{panel.title}</h3>
              <p>{panel.body}</p>
            </article>
          ))}
        </div>
      </RevealSection>

      <RevealSection as="section" className="editorial-block results-block">
        <div id="outputs" className="section-anchor" />
        <div className="block-heading">
          <span className="eyebrow">输出产物</span>
          <h2>分析完成后，ArkTaint 会把关键结果和诊断信息一起落盘</h2>
          <p>
            输出目录中会同时保存 summary、diagnostics、feedback、inventory 和路径级结果，便于对项目做复核、追踪和复跑。
          </p>
        </div>
        <div className="result-table">
          <div className="result-row">
            <span>summary</span>
            <strong>总耗时、阶段统计、结构审计和分析摘要。</strong>
          </div>
          <div className="result-row">
            <span>diagnostics</span>
            <strong>入口恢复、规则命中、候选缺口和失败原因。</strong>
          </div>
          <div className="result-row">
            <span>feedback</span>
            <strong>未知 API、规则候选、模型缺口与人工复核入口。</strong>
          </div>
          <div className="result-row">
            <span>inventory</span>
            <strong>真实项目清单、正式主链结果、开销结果和输出目录。</strong>
          </div>
        </div>
      </RevealSection>
    </main>
  );
}
