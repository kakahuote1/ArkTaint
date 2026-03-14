# wanharmony 真实项目深度审计（Phase 7.7.2 Step B）

## 1. 审计对象与口径
- 项目路径：`tmp/phase43/repos/wanharmony`
- 分析范围：`entry/src/main/ets`
- 审计锚点（人工确认）：
  - V1（高危）：`tmp/phase43/repos/wanharmony/entry/src/main/ets/view/Article/ArticleItem.ets:58` -> `tmp/phase43/repos/wanharmony/entry/src/main/ets/pages/WebPage.ets:6` -> `tmp/phase43/repos/wanharmony/entry/src/main/ets/pages/WebPage.ets:27`
  - V2（中危）：`tmp/phase43/repos/wanharmony/entry/src/main/ets/entryability/EntryAbility.ets:25`、`tmp/phase43/repos/wanharmony/entry/src/main/ets/entryability/EntryAbility.ets:28`、`tmp/phase43/repos/wanharmony/entry/src/main/ets/entryability/EntryAbility.ets:30`
  - V3（中危）：`tmp/phase43/repos/wanharmony/entry/src/main/ets/pages/KnowledgeDetail.ets:12`、`tmp/phase43/repos/wanharmony/entry/src/main/ets/pages/KnowledgeDetail.ets:17`、`tmp/phase43/repos/wanharmony/entry/src/main/ets/viewmodel/KnowledgeViewModel.ets:45`

## 2. Step B 项目规则
- 规则文件：`tests/rules/real_project/wanharmony.project.rules.json`
- 规则层覆盖：
  - `sources`：`onCreate(want)`、`router.getParams()`、`ArticleBean.link` 字段读、`KnowledgeDetail.courseId` 字段读、`WebPage.url` 字段读
  - `sinks`：`GlobalContext.setObject(arg1)`、`getKnowledgeDetail(arg0)`、`Web.create(arg0)`、`pushUrl(arg0)`
  - `transfers`：`GlobalContext.setObject/getObject`、`getKnowledgeDetail`、`fetch`

## 3. 三口径对照运行（Step A 前 / Step A 后 / Step B）

复现命令：

```powershell
npm run analyze -- --repo tmp/phase43/repos/wanharmony --sourceDir entry/src/main/ets --default tmp/phase772/default_pre_stepA_sim.rules.json --framework rules/framework.rules.json --profile default --k 1 --maxEntries 50 --crossFunctionFallback --secondarySinkSweep --reportMode full --no-incremental --outputDir tmp/phase772/wanharmony_stepB_compare/pre_stepA_sim

npm run analyze -- --repo tmp/phase43/repos/wanharmony --sourceDir entry/src/main/ets --default rules/default.rules.json --framework rules/framework.rules.json --profile default --k 1 --maxEntries 50 --reportMode full --no-incremental --outputDir tmp/phase772/wanharmony_stepB_compare/stepA_only

npm run analyze -- --repo tmp/phase43/repos/wanharmony --sourceDir entry/src/main/ets --default rules/default.rules.json --framework rules/framework.rules.json --project tests/rules/real_project/wanharmony.project.rules.json --profile default --k 1 --maxEntries 50 --reportMode full --no-incremental --outputDir tmp/phase772/wanharmony_stepB_compare/stepB_with_project
```

结果摘要：

| 口径 | rule_layers | entries | ok_entries | with_flows | total_flows |
|---|---|---:|---:|---:|---:|
| Step A 前模拟 | `default -> framework` | 50 | 41 | 0 | 0 |
| Step A 后 | `default -> framework` | 50 | 41 | 0 | 0 |
| Step B（含 project） | `default -> framework -> project` | 50 | 41 | 2 | 2 |

证据产物：
- `tmp/phase772/wanharmony_stepB_compare/pre_stepA_sim/summary.json`
- `tmp/phase772/wanharmony_stepB_compare/stepA_only/summary.json`
- `tmp/phase772/wanharmony_stepB_compare/stepB_with_project/summary.json`

## 4. Ground Truth 对比（锚点级）

| 锚点 | 预期 | 实际 | 证据 |
|---|---|---|---|
| V1 `articleBean.link -> pushUrl -> getParams -> Web(src)` | 检出 | 未检出（FN） | `stepB_with_project` 无对应 flow |
| V2 `want -> setObject('abilityWant', want)` | 检出 | 检出（TP） | `entry=onCreate`，sink=`GlobalContext.setObject(..., want)` |
| V3 `courseId -> getKnowledgeDetail(courseId)` | 检出 | 检出（TP） | `entry=aboutToAppear`，sink=`.getKnowledgeDetail()(%0)` |

Step B 当前锚点指标（按 V1/V2/V3）：
- TP=2
- FP=0（锚点集合内）
- FN=1
- Precision=100.0%
- Recall=66.7%

## 5. 结论与后续
- Step B 已满足“至少检出 1-2 条锚点漏洞”的入站标准（当前检出 2 条：V2/V3）。
- V1 仍为已知缺口，根因是跨页面链路 `pushUrl -> getParams -> Web(src)` 需更强的 Router/页面装配建模（后续 7.8.1）。
- 本文档作为 7.7.2 的人工 Ground Truth 与对照证据基线，后续每轮规则/引擎改动在此文档追加差异结论。
