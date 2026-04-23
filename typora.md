**主要问题**

- **阻塞：npm install 当前不可用。** package.json:7 新增 postinstall: npm install --prefix arkanalyzer，但 arkanalyzer 自己也有 postinstall：arkanalyzer/package.json:17，且其脚本里再次执行 npm install ... --no-save：npmInstall.js:36。我实际运行 npm install 失败，导致 arkanalyzer/out 和 ohos-typescript 没补齐，后续 npm run build 无法作为有效门禁。
- **阻塞：SemanticFlow session cache 被拆坏。** SemanticFlowPipeline.ts:34 的 options 已经没有 sessionCache，但现有测试仍在传 sessionCache：test_semanticflow_llm_session_cache.ts:175。也就是说这部分不是完整删除，也不是完整迁移，属于半拆状态。这个和“skills/上下文压缩”不是一件事，不该混进来。
- **高风险：callback 传播路径可能被删断。** SyntheticInvokeCallbacks.ts:175 现在在 resolvedCallees.length === 0 时直接返回。此前 known option callback registration 会在这类场景下补边；现在虽然 FrameworkCallbackClassifier.ts:440 增加了 controller option 解析，但合流到 synthetic invoke 边的旧路径被移除了。更糟的是 test:entry-model:provenance 里也不再跑 option callback provenance 测试：package.json:104。
- **高风险：SinkDetector 的 kill 逻辑会影响主分析精度。** SinkDetector.ts:742 把“后续常量赋值”变成强 kill，但这个 PR 同时删掉了之前对 interprocedural/capture taint target 的保护逻辑。这个改动可能制造跨过程或闭包传播场景的漏报，且完全偏离 skills/context 主题。
- **中风险：context pack 的预算契约不严格。** context_pack.ts:387 进入 hard minimal fallback 后，仍没有保证最终 markdown 一定小于 maxChars。既然这是“上下文压缩”，预算上限应该是硬契约，至少要测试极小 maxChars 下的行为。
- **小问题：文档示例不可复现。** docs/context/README.md:11 引用了 docs/context/raw_notes_example.txt，但分支里没有这个文件。

