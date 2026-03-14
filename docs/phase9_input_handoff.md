# Phase 9 输入资产移交清单（来自 Phase 7.9.5）

## 1. 目标与边界
- 本清单仅移交 Phase 9 所需输入资产，不包含任何 `LLM` 运行时接入实现。
- Phase 7.9 固定对照口径仅为：
  - `default+framework`
  - `default+framework+project_candidate`
- 明确禁止：在 Phase 7.9 引入 `+llm_refined` 运行链路。

## 2. 移交资产
- 对照摘要（7.9.5.1）：
  - `tmp/phase79/phase95_assets/compare_summary.json`
  - `tmp/phase79/phase95_assets/compare_summary.md`
- C2 候选切片（7.9.5.2）：
  - `tmp/phase79/phase95_assets/c2_candidate_slices.json`
  - `tmp/phase79/phase95_assets/c2_candidate_slices.md`
- 真实性标注基线（引用 7.9.3）：
  - `docs/real_project_flow_audit.md`
  - 当前基线结论：`TP=0`、`FP=5`（当前 smoke 口径）

## 3. 可直接喂给 Phase 9 的最小输入结构
- 每个 C2 切片条目至少包含：
  - `signature`
  - `invokeKind`
  - `argCount`
  - `scope`
  - `sourceFile` / `sourcePath` / `line`
  - `evidence`
  - `count`
- 推荐优先级：按 `count` 降序，先处理高频 C2 包装层函数。

## 4. 本轮关键对照结果（供 Phase 9 启动参考）
- 来源：
  - `tmp/real_projects/wanandroid_default_framework/summary.json`
  - `tmp/real_projects/wanandroid_plus_project/summary.json`
- 指标变化（`+project_candidate` 相对 baseline）：
  - `withFlows`: `5 -> 7`（`+2`）
  - `totalFlows`: `7 -> 9`（`+2`）
  - `noCandidateRuleForCallsite`: `65 -> 44`（`-21`）
- 解读约束：上述变化仅表示“规则覆盖/可达性提升”，不直接等价于“安全能力提升”，必须结合 `7.9.3` 真实性审计解释。

## 5. 风险与后续动作
- 风险 R1：`no_candidate_project_candidates.json` 当前为非严格 JSON（编码/转义问题），本轮切片从同源 `.md` 提取。
- 风险 R2：当前 C2 输入主要来自 `RdbPlus`，项目覆盖仍有限。
- Phase 9 启动建议：
  - 先以 `c2_candidate_slices.json` 作为首批输入池；
  - 追加更多真实项目的 C2 池后再扩展到 Top-N 批量生成；
  - 对 LLM 产出的候选规则执行既有门禁，再决定是否晋升。
