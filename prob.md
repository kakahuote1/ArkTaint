**阻塞问题**

- package.json (line 7) 新增 postinstall: npm install --prefix arkanalyzer，但 npmInstall.js (line 52) 又在子工程 postinstall 中执行 npm install ... --no-save，实际运行 npm install --prefix arkanalyzer 出现递归式失败，最终导致 ohos-typescript 未安装。后果是 test:kernel-guard、test:semanticflow:cli、test:semanticflow:auto、test:sink-exact 都因 Cannot find module 'ohos-typescript' 失败。这个必须先修。
- SemanticFlow session cache 被从 CLI/autoModel 路径拆掉了。核心管线仍支持 sessionCache，见 SemanticFlowPipeline.ts (line 46)，但 semanticflow.ts (line 27) 的 CLI options 和 SemanticFlowProject.ts (line 13) 的项目入口已经不再接收/传递 cache。对应测试也删掉了 cache manifest/cache stats 断言。这和“上下文压缩/状态复用”的目标相冲突，除非明确决定废弃 CLI 级 session cache，否则不能合。

**高风险问题**

- callback 传播路径被改动，风险较大。SyntheticInvokeCallbacks.ts (line 176) 现在只在 resolvedCallees.length === 0 时走 controller option callback 注册逻辑；此前 known option callback registration 是更通用的补边路径。这个改动可能影响已有 option callback 场景，需要恢复原有覆盖或补强回归。
- SinkDetector.ts (line 769) 改了常量赋值 kill 逻辑，还删掉了原先 capture/interprocedural taint target 的部分保护。这属于主分析精度改动，和 skills/context 主题不强相关。当前因为 arkanalyzer 依赖坏了，相关回归没法跑完，不建议带着这个风险 merge。
- test_arktaint_bench.ts (line 790) 改了 benchmark 统计口径，把 boundary lane 直接纳入总评分，同时 manifest 里移除了 observation-only 口径。这是实验/基准定义变化，不应该混在 skills/context PR 里，除非单独说明并评审。

**需要清理**

- typora.md (line 1) 是临时审查记录，而且内容里还包含旧问题描述，不应提交到仓库根目录。
- docs/context/README.md (line 11) 引用了 docs/context/raw_notes_example.txt，但该文件不存在。
- git diff --check 发现多处 trailing whitespace / EOF 空行问题，主要在新增 docs 和 skills 文件里，合并前应清理。

**已验证**

- npm run build 通过。
- npm run test:context-skills-tooling 通过。
- npm run skills:validate 通过。
- node out/tests/runtime/test_semanticflow_llm_session_cache.js 通过。
- 多个依赖 arkanalyzer 的测试失败，根因是安装链路未能补齐 ohos-typescript。