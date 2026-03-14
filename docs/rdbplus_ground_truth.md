# RdbPlus 真实项目审计（Phase 7.7.2）

## 1. 审计对象与口径

- 项目路径：`tmp/phase43/repos/RdbPlus`
- 代码提交：`4a3fc04ba5903bc1c1b194efbc557017976909dc`
- 分析范围：`entry/src/main/ets`
- 审计口径：
  - Source（外部可控）：`Want/路由参数/UI 文本输入/网络响应`
  - Sink（安全敏感落点）：`数据库写入执行/网络发送/日志外发`
  - 仅将“外部可控数据到敏感落点”计为正样本（真实漏洞流）

## 2. ArkTaint 基线运行（不改引擎）

执行命令：

```powershell
npm run analyze -- --repo tmp/phase43/repos/RdbPlus --sourceDir entry/src/main/ets --k 1 --maxEntries 50 --no-incremental --reportMode full --outputDir tmp/phase772/rdbplus_full
```

运行结果（`tmp/phase772/rdbplus_full/summary.json`）：

- `entries=50`
- `ok_entries=43`
- `with_seeds=43`
- `with_flows=22`
- `total_flows=22`
- `stage_profile.totalMs=520.814`
- `rule_hits.source={"harmony.lifecycle.want_param":1,"source.local_name.primary":34}`
- `rule_hits.sink={"sink.keyword.rdb":22}`

告警特征：

- 22 条流全部命中 `sink.keyword.rdb`
- 实际 sink 样本均为 `showDialog(...)`（位于 `@ets/rdb/MessageDialog.ets`），未命中真实数据库执行 API

## 3. 人工 Ground Truth（逐文件审计）

审计文件：

- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/pages/Index.ets`
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/rdb/EmpMapper.ets`
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/rdb/MessageDialog.ets`
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/entryability/EntryAbility.ets`
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/entrybackupability/EntryBackupAbility.ets`

关键代码位点：

- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/entryability/EntryAbility.ets:6`
  - `onCreate(want, ...)` 存在入口参数，但未形成到敏感 sink 的链路。
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/pages/Index.ets:20`
  - `showDialog(...)` 大量用于 UI 提示，参数来自常量/查询结果展示，不是安全敏感 sink。
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/pages/Index.ets:324`
  - `update(...)` 为数据库操作，但参数使用常量条件，不存在外部可控输入直达。
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/pages/Index.ets:335`
  - `delete(...)` 也是固定常量条件，不构成外部可控污点链。
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/rdb/EmpMapper.ets:34`
  - `execDML(...)` 为建表/迁移 SQL，SQL 为静态常量。
- `tmp/phase43/repos/RdbPlus/entry/src/main/ets/rdb/MessageDialog.ets:22`
  - `showDialog(msg, ...)` 本质是 UI 弹窗，不属于本审计定义的敏感 sink。

人工结论：

- 真实正样本（Ground Truth positives）：`0`
- 该项目在当前审计口径下未发现“外部可控数据 -> 安全敏感 sink”的可确认链路。

## 4. 对比结果（ArkTaint vs Ground Truth）

按“告警级别”统计：

- 引擎告警总数：`22`
- 人工真实正样本：`0`

混淆统计：

- `TP=0`
- `FP=22`
- `FN=0`

指标：

- `Precision = TP / (TP + FP) = 0 / 22 = 0.0%`
- `Recall = TP / (TP + FN)`：本次不适用（分母为 0，无真实正样本）

## 5. 误报根因分析

1. `sink.keyword.rdb` 关键词过宽  
   - 由于 `showDialog` 所在路径含 `rdb` 目录名，被关键词规则误命中为 sink。
2. `source.local_name.primary` 在真实项目中过宽  
   - 局部变量名与 UI 展示参数（如 `msg`）被当作 source，放大误报。
3. `init:cross_function_fallback` 在 UI 入口上触发较多  
   - 在缺少明确 source 证据时，启发式播种进一步抬高告警量。

## 6. 结论与后续动作

- 7.7.2 的“真实项目基线 + 人工 Ground Truth + 交叉对比”已完成。
- 本次结果证明：当前规则在真实项目上的主要问题是 **规则精度（尤其 sink/source 过宽）**，而不是崩溃或不可运行。
- 下一步应优先修复：
  1. 将 `sink.keyword.rdb` 收紧为数据库 API 签名级规则（避免路径关键词误命中）。
  2. 为真实项目审计模式降低/限制 `source.local_name.primary` 与 fallback 播种。
  3. 在报告中单列“关键词命中型告警”与“签名命中型告警”。
