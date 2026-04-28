import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface OverviewProps {
  onStart: () => void;
}

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) entry.target.classList.add('active');
      },
      { threshold: 0.14 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return ref;
}

function RevealSection({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useReveal();
  return <section ref={ref} className={`reveal ${className}`} style={style}>{children}</section>;
}

function PipelineGraph() {
  return (
    <svg className="pipeline-graph" viewBox="0 0 920 520" role="img" aria-label="ArkTaint 分析链路">
      <defs>
        <linearGradient id="pipeLine" x1="0" x2="1">
          <stop offset="0" stopColor="#2f6fed" />
          <stop offset="1" stopColor="#18a0a6" />
        </linearGradient>
        <marker id="pipeArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6fed" />
        </marker>
      </defs>
      <rect x="44" y="38" width="832" height="444" rx="24" />
      <g className="graph-row" transform="translate(92 88)">
        <rect width="168" height="86" rx="16" />
        <text x="24" y="34">项目输入</text>
        <text x="24" y="60" className="muted">ArkTS 源码与模型资产</text>
      </g>
      <g className="graph-row" transform="translate(318 88)">
        <rect width="168" height="86" rx="16" />
        <text x="24" y="34">入口恢复</text>
        <text x="24" y="60" className="muted">生命周期、回调、组件入口</text>
      </g>
      <g className="graph-row strong" transform="translate(544 88)">
        <rect width="230" height="86" rx="16" />
        <text x="24" y="34">统一延后传播表示</text>
        <text x="24" y="60" className="muted">绑定、摘要、传播边</text>
      </g>

      <g className="graph-row" transform="translate(92 308)">
        <rect width="168" height="86" rx="16" />
        <text x="24" y="34">传播建图</text>
        <text x="24" y="60" className="muted">调用图与 PAG</text>
      </g>
      <g className="graph-row" transform="translate(318 308)">
        <rect width="168" height="86" rx="16" />
        <text x="24" y="34">污点求解</text>
        <text x="24" y="60" className="muted">源点到汇点可达性</text>
      </g>
      <g className="graph-row" transform="translate(544 308)">
        <rect width="230" height="86" rx="16" />
        <text x="24" y="34">报告与复核</text>
        <text x="24" y="60" className="muted">摘要、诊断、命中规则</text>
      </g>

      <path className="graph-flow" d="M260 131 H318" markerEnd="url(#pipeArrow)" />
      <path className="graph-flow" d="M486 131 H544" markerEnd="url(#pipeArrow)" />
      <path className="graph-flow" d="M658 174 C658 230 176 236 176 308" markerEnd="url(#pipeArrow)" />
      <path className="graph-flow" d="M260 351 H318" markerEnd="url(#pipeArrow)" />
      <path className="graph-flow" d="M486 351 H544" markerEnd="url(#pipeArrow)" />
      <path className="graph-flow soft" d="M176 174 C176 228 430 228 430 308" />
      <path className="graph-flow soft" d="M680 174 C784 234 792 320 774 394" />
    </svg>
  );
}

const capabilityItems = [
  ['框架入口恢复', '识别 Ability 生命周期、组件入口和框架回调，把隐式入口纳入分析范围。'],
  ['统一延后传播表示', '在求解前恢复事件、Promise、声明式状态更新等跨调用栈传播关系。'],
  ['PAG 传播建图', '将恢复出的传播事实转化为后续求解器可消费的结构边。'],
  ['规则与模型治理', '用规则、模块和插件分层管理源点、汇点、传播、净化与复杂 API 行为。'],
  ['语义补全流程', '对未知 API 生成候选解释和人工复核入口，减少第三方接口缺口。'],
  ['可复核产物', '输出摘要、诊断、命中记录和报告，便于定位源码与复现实验结果。']
];

const workflowItems = [
  ['选择工程', '配置 ArkTaint 根目录、目标项目和 ArkTS 源码目录。'],
  ['选择策略', '在快速排查、标准分析和深度审计之间切换，自动带出常用参数。'],
  ['确认能力', '按需启用延后传播表示、完整报告、增量缓存和语义建模。'],
  ['查看结果', '从运行日志进入 summary、规则反馈、模型缺口和源点到汇点流。']
];

export default function Overview({ onStart }: OverviewProps) {
  return (
    <main className="overview-page">
      <section className="product-hero">
        <div className="product-copy">
          <span className="eyebrow">ArkTS 静态污点分析</span>
          <h1>ArkTaint 是面向 HarmonyOS 项目的数据流分析工作台</h1>
          <p>
            它围绕 ArkTS 框架入口、回调、异步结算和声明式状态传播构建分析链路，
            将分散在运行时和框架中的传播关系转化为可求解、可追踪、可复核的污点分析结果。
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onStart}>进入分析控制台</button>
            <a className="text-link" href="#capabilities">查看能力结构</a>
          </div>
        </div>
        <div className="product-visual">
          <PipelineGraph />
        </div>
      </section>

      <RevealSection className="overview-note">
        <div>
          <strong>定位</strong>
          <span>静态分析工具，不依赖运行时插桩，适合项目审计、规则验证和论文实验复核。</span>
        </div>
        <div>
          <strong>主线</strong>
          <span>入口恢复、传播建图、延后传播表示、污点求解、诊断报告。</span>
        </div>
        <div>
          <strong>产物</strong>
          <span>源点到汇点流、规则命中、候选 API、模型缺口、摘要和可复核报告。</span>
        </div>
      </RevealSection>

      <div id="capabilities" />

      <RevealSection className="content-section">
        <div className="section-heading">
          <span className="eyebrow">系统能力</span>
          <h2>围绕静态污点分析链路组织，而不是堆叠单点功能</h2>
          <p>每一项能力都对应分析过程中的一个结构位置，最终服务于更完整的源点到汇点可达性判断。</p>
        </div>
        <div className="capability-grid">
          {capabilityItems.map(([title, desc]) => (
            <article key={title} className="capability-item">
              <strong>{title}</strong>
              <p>{desc}</p>
            </article>
          ))}
        </div>
      </RevealSection>

      <RevealSection className="content-section split-section">
        <div className="section-heading compact">
          <span className="eyebrow">使用流程</span>
          <h2>控制台只暴露必要决策，复杂能力进入分组配置</h2>
          <p>
            日常使用只需要选择工程和分析策略；规则、模型、插件、检查模式和语义建模放入高级域，
            避免把底层命令细节直接暴露给用户。
          </p>
        </div>
        <ol className="workflow-list">
          {workflowItems.map(([title, desc], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{title}</strong>
                <p>{desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </RevealSection>

      <RevealSection className="content-section artifact-section">
        <div className="section-heading compact">
          <span className="eyebrow">结果复核</span>
          <h2>从结论回到证据</h2>
          <p>
            ArkTaint 的报告不是只给出一个告警列表，而是保留规则命中、模型来源、传播路径和摘要信息。
            用户可以沿着报告回到源码位置，判断每条流是否来自有效传播关系。
          </p>
        </div>
        <div className="artifact-table">
          <div><span>summary</span><strong>整体统计与源点到汇点流</strong></div>
          <div><span>feedback</span><strong>规则候选、未知 API 与模型缺口</strong></div>
          <div><span>diagnostics</span><strong>传播建图、入口恢复与分析过程诊断</strong></div>
          <div><span>reports</span><strong>面向复核和归档的可读报告</strong></div>
        </div>
      </RevealSection>

      <RevealSection className="closing-section">
        <div>
          <span className="eyebrow">开始使用</span>
          <h2>用控制台完成一次真实项目分析</h2>
          <p>先选择 ArkTaint 根目录和目标项目，再选择分析策略；高级域仅在需要调整规则、模型、插件或检查模式时展开。</p>
        </div>
        <button className="btn btn-primary" onClick={onStart}>进入控制台</button>
      </RevealSection>
    </main>
  );
}
