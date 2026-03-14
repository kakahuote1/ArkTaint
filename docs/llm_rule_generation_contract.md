# LLM Rule Generation Contract (Phase 7.7.2.4)

## 1. 目的与边界

本协议用于 Phase 9 前置资产定义，目标是让 LLM 对“引擎筛出的卡点函数”做规则分类，产出 `llm_candidate` 候选规则。

- 只做：`source/sink/transfer/sanitizer` 候选规则生成。
- 不做：全项目漏洞发现、跨页面/并发图能力补全、自动改 `src/core/**`。
- 实现边界：本阶段仅文档与样本，不引入 LLM 执行代码。

## 2. 输入协议（LLM 请求）

```json
{
  "contractVersion": "1.0",
  "project": {
    "name": "wanharmony",
    "repoPath": "tmp/phase43/repos/wanharmony",
    "sourceDirs": ["entry/src/main/ets"],
    "ruleLayers": ["default", "framework"]
  },
  "constraints": {
    "topN": 25,
    "allowedKinds": ["source", "sink", "transfer", "sanitizer"],
    "forbidFrameworkDuplicate": true,
    "maxRulesPerHotspot": 2
  },
  "hotspots": [
    {
      "id": "hs_001",
      "reason": "no_candidate_rule_for_callsite",
      "functionSignature": "@ets/viewmodel/KnowledgeViewModel.ets: KnowledgeViewModel.getKnowledgeDetail(string)",
      "callsiteSignature": "instanceinvoke this.<...getKnowledgeDetail()>(courseId)",
      "file": "entry/src/main/ets/pages/KnowledgeDetail.ets",
      "method": "aboutToAppear",
      "snippet": "this.viewModel.getKnowledgeDetail(this.courseId)",
      "dataflowHint": {
        "from": "arg0",
        "to": "result"
      }
    }
  ]
}
```

### 2.1 卡点原因到规则类型映射（硬约束）

- `no_candidate_rule_for_callsite` -> 优先输出 `transfer`
- `no_transfer` -> 优先输出 `transfer`
- `unknown_external_function` -> 输出 `source` 或 `sink`（二选一）
- `no_sink_match_on_tainted_path` / `no_sink_match` -> 优先输出 `sink`
- `flow_found_on_path_without_guard` -> 优先输出 `sanitizer`

## 3. 输出协议（LLM 响应）

```json
{
  "contractVersion": "1.0",
  "decisions": [
    {
      "hotspotId": "hs_001",
      "action": "emit_rule",
      "ruleKind": "transfer",
      "confidence": 0.86,
      "rationale": "courseId 作为请求参数影响返回对象",
      "rule": {
        "id": "transfer.llm.wanharmony.knowledge.getKnowledgeDetail.arg0_to_result",
        "enabled": false,
        "match": {
          "kind": "signature_contains",
          "value": ".getKnowledgeDetail()"
        },
        "from": "arg0",
        "to": "result",
        "scope": {
          "className": {
            "mode": "equals",
            "value": "KnowledgeViewModel"
          }
        }
      }
    }
  ]
}
```

`action` 允许值：
- `emit_rule`：生成候选规则
- `skip_framework_covered`：已被 `framework` 覆盖，跳过
- `insufficient_context`：上下文不足，不生成

## 4. 规则字段规范（对齐 RuleSchema 1.1）

- `source`：必须包含 `match + targetRef.endpoint`，可含 `kind`（如 `call_return/entry_param/field_read/callback_param`）。
- `sink`：必须包含 `match + sinkTargetRef.endpoint`。
- `transfer`：必须包含 `match + from + to`。
- `sanitizer`：必须包含 `match + sanitizeTargetRef.endpoint`。
- 推荐约束：优先 `method_name_equals/signature_equals/callee_signature_equals + scope`；避免宽泛关键词。

## 5. 门禁要求（llm_candidate -> project 前）

1. **Schema 门禁**：必须通过 `RuleValidator`。
2. **重复门禁**：禁止与 `default/framework` 产生同义重复（同 `match + endpoint + scope`）。
3. **精度门禁**：不得降低 `verify` 基线（`k=1` 保持 `230/230`）。
4. **项目门禁**：必须有最小复现实验（至少 1 个真实项目或 1 组 HarmonyBench 证据）。

## 6. 回滚策略

- `llm_candidate.rules.json` 默认 `enabled=false`。
- 任一候选规则导致 FP 上升或基线回归时，直接禁用该规则并记录原因。
- 所有晋升到 `project.rules.json` 的规则必须保留来源审计：`origin=llm`、`hotspotId`、`rationale`。

## 7. 产物约定

- 协议文档：`docs/llm_rule_generation_contract.md`
- few-shot 样本：`docs/llm_fewshot_wanharmony.json`
- 本阶段不新增 `src/core/**` 的 LLM 执行代码。
