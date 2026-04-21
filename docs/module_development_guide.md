# ArkTaint Modules 编写说明

这份文档只讲 `modules`。

你应该在这两种情况写 module：

- `rules` 无法表达该语义
- 你不想改分析流程本身，只想补某类 API / 框架 / SDK 的硬编码语义

如果只是标 source / sink / transfer / sanitizer，请先看 [Rules](./rule_schema.md)。
如果要改 entry / propagation / detection / result 流程，请看 [Plugins](./engine_plugin_guide.md)。

## 1. 当前 module 系统的核心原则

- 只有一种写法：`defineModule(...)`
- module 仍然是代码，不是配置
- `src/modules/**` 下面只放 module 本体
- 内建 module 分 `kernel`
- 外部 / 项目 module 分 `project`
- 目录下递归发现所有 `.ts`
- 单文件删除即可移除 module
- 文件内 `enabled: false` 可禁用
- CLI 能禁用单个 module 或整个 project
- 遇到陌生 API、rules 不够时，优先改 module，不改 kernel

## 2. 目录模型

内建 modules：

```text
src/modules/
  kernel/
    harmony/
      router.ts
      state.ts
      emitter.ts
    tsjs/
      container.ts
```

项目 modules：

```text
my_modules/
  project/
    acme_sdk/
      upload_bridge.ts
      state_patch.ts
```

说明：

- `kernel/` 自动加载
- `project/<project-id>/` 默认不加载
- 需要 `--enable-module-project <project-id>`

## 3. 加载与禁用

### 3.1 加载一个外部 module 根

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --module-root D:\projects\my_modules \
  --enable-module-project acme_sdk
```

### 3.2 禁用整个 project

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --module-root D:\projects\my_modules \
  --enable-module-project acme_sdk \
  --disable-module-project acme_sdk
```

### 3.3 禁用单个 module

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --module-root D:\projects\my_modules \
  --enable-module-project acme_sdk \
  --disable-module acme.upload_bridge
```

### 3.4 文件内禁用

```ts
export default defineModule({
  id: "acme.upload_bridge",
  description: "disabled variant",
  enabled: false,
});
```

## 4. 作者唯一入口

当前 project module 应使用公开入口：

```ts
import { defineModule } from "@arktaint/module";
```

这是你应该优先使用的唯一入口。

不要依赖：

- `src/core/orchestration/modules/...`
- `src/core/kernel/...`
- 其他私有内部实现

对于 `project` module，loader 会审计私有导入并直接拒绝加载。

## 5. 最小 module 形态

```ts
import { defineModule } from "@arktaint/module";

export default defineModule({
  id: "project.acme.demo",
  description: "Acme semantic patch",
  enabled: true,

  setup(ctx) {
    return {
      onFact(event) {
        return [];
      },

      onInvoke(event) {
        return [];
      },

      shouldSkipCopyEdge(event) {
        return false;
      },
    };
  },
});
```

如果一个文件导出多个 module，loader 会分别处理它们。

## 6. setup / onFact / onInvoke / shouldSkipCopyEdge

### `setup(ctx)`

只在 module 初始化时执行一次。适合：

- 建索引
- 预扫描 scene / pag
- 构造静态模型

### `onFact(event)`

当当前 taint fact 被处理时调用。适合：

- 对某个对象字段继续桥接
- 做 load / store continuation

### `onInvoke(event)`

当当前 taint fact 到达某个调用点时调用。适合：

- callback handoff
- arg / base / result 之间的复杂桥接
- router / state / storage 这种 invoke 驱动语义

### `shouldSkipCopyEdge(event)`

适合在极少数情况下压制过宽 copy-edge。只有你明确知道自己在抑制什么时才用。

## 7. 当前作者 API

### 7.1 `setup(ctx)`

`setup(ctx)` 里的主要对象：

- `ctx.methods`
  - 枚举方法，不用自己扫 `scene.getMethods()`
- `ctx.scan`
  - setup 阶段的高层扫描 API
- `ctx.bridge`
  - setup 阶段可复用的 node / field relay 原语
- `ctx.callbacks`
  - setup 阶段 callback 解析 helper
- `ctx.analysis`
  - 面向作者的分析 helper
- `ctx.debug.summary(...)`
- `ctx.log(...)`
- `ctx.raw`
  - 原始底层对象，必要时下钻

### 7.2 `ctx.methods`

方法枚举 helper：

- `all()`
- `byName(methodName)`
- `byClassName(className)`

如果你只是在找某类方法，优先用这一层，不要直接去扫 `ctx.raw.scene`。

### 7.3 `ctx.scan`

setup 阶段高层扫描 API：

- `invokes(...)`
- `parameterBindings(...)`
- `assigns(...)`
- `fieldLoads(...)`
- `fieldStores(...)`
- `decoratedFields(...)`

这组 API 的作用是：

- 在 setup 阶段预扫描语义线索
- 直接返回已经整理好的调用、字段 load/store、装饰器信息
- 尽量避免作者自己写一大段 `instanceof ArkAssignStmt` 之类的底层遍历

### 7.4 `ctx.bridge`

setup 阶段 bridge 原语：

- `nodeRelay()`
- `keyedNodeRelay()`
- `fieldRelay()`

适合：

- 预先建立 node 到 node 的桥接
- 预先建立字段桥接或字段 load-like 桥接

### 7.5 `ctx.callbacks`

setup 阶段 callback 解析 helper：

- `methods(callbackValue, options?)`
- `paramBindings(callbackValue, paramIndex, options?)`
- `paramNodeIds(callbackValue, paramIndex, options?)`

如果你在 setup 阶段需要把某个 callback 注册语义预扫描出来，优先用这一组。

### 7.6 `ctx.analysis`

setup 阶段分析 helper：

- `nodeIdsForValue(value, anchorStmt?)`
- `objectNodeIdsForValue(value)`
- `carrierNodeIdsForValue(value, anchorStmt?)`
- `aliasLocalsForCarrier(carrierNodeId)`
- `stringCandidates(value, maxDepth?)`

常用理解：

- `nodeIdsForValue`
  - 找值的普通节点
- `objectNodeIdsForValue`
  - 找对象节点
- `carrierNodeIdsForValue`
  - 找更适合桥接的 carrier 节点
- `stringCandidates`
  - 对字符串 key / route name / event name 做有限候选恢复

### 7.7 `event.current`

当前事实视图：

- `nodeId`
- `source`
- `contextId`
- `value`
- `field`
- `hasField()`
- `fieldHead()`
- `fieldTail()`
- `cloneField()`

### 7.8 `event.call`

调用点视图：

- `signature`
- `methodName`
- `declaringClassName`
- `argCount`
- `matchesSignature(...)`
- `matchesMethod(...)`
- `matchesClass(...)`

### 7.9 `event.values`

取值 helper：

- `arg(index)`
- `args()`
- `base()`
- `result()`
- `stringArg(index, maxDepth?)`
- `stringCandidates(value, maxDepth?)`

### 7.10 `event.match`

当前 taint 与调用值的对齐 helper：

- `value(value)`
- `arg(index)`
- `base()`
- `result()`

这组 API 适合做“当前 fact 是否真的落在我关心的那个值上”的判断。

### 7.11 `event.analysis`

invoke/fact 阶段分析 helper：

- `nodeIdsForValue(value, anchorStmt?)`
- `objectNodeIdsForValue(value)`
- `carrierNodeIdsForValue(value, anchorStmt?)`
- `aliasLocalsForCarrier(carrierNodeId)`
- `stringCandidates(value, maxDepth?)`

### 7.12 `event.emit`

发射 helper：

- `toNode(...)`
- `toNodes(...)`
- `preserveToNode(...)`
- `preserveToNodes(...)`
- `toCurrentFieldTailNode(...)`
- `toCurrentFieldTailNodes(...)`
- `toField(...)`
- `toFields(...)`
- `toValueField(...)`
- `loadLikeToNode(...)`
- `loadLikeToNodes(...)`
- `loadLikeCurrentFieldTailToNode(...)`
- `loadLikeCurrentFieldTailToNodes(...)`
- `collector()`

理解建议：

- `toNode / toNodes`
  - 发 generic taint
- `preserveTo*`
  - 保留当前 field path
- `toCurrentFieldTail*`
  - 使用当前 field tail
- `toField / toFields`
  - 显式设置字段路径
- `toValueField`
  - 让运行时自己把目标值映射到合适的字段宿主对象
- `loadLike*`
  - 发出“像字段 load 一样”的 taint

### 7.13 `event.callbacks`

callback handoff helper：

- `paramNodeIds(callbackValue, paramIndex, options?)`
- `toParam(...)`
- `preserveToParam(...)`
- `toCurrentFieldTailParam(...)`
- `toFieldParam(...)`

如果你要把 taint 送进 callback 参数，优先用这一组。

### 7.14 `event.debug`

- `hit(message)`
- `skip(message)`
- `log(message)`
- `summary(label, metrics, options?)`

这组输出会进入 module audit，用于 `--trace-module`。

### 7.15 `raw`

底层原始对象：

- `ctx.raw.scene`
- `ctx.raw.pag`
- `event.raw.stmt`
- `event.raw.invokeExpr`
- `event.raw.pag`

原则：

- 默认先用高层 API
- 高层 API 不够时再下钻 `raw`
- `raw` 是显式 escape hatch，不是默认作者面

## 8. 两个推荐模板

### 8.1 callback handoff module

```ts
import { defineModule } from "@arktaint/module";

export default defineModule({
  id: "acme.callback_bridge",
  description: "Bridge Register(value, callback) into callback param 0.",

  setup() {
    return {
      onInvoke(event) {
        if (!event.call.matchesMethod("Register")) return;

        const payload = event.values.arg(0);
        const callback = event.values.arg(1);
        if (!payload || !callback) return;

        if (!event.match.arg(0)) return;

        return event.callbacks.preserveToParam(
          callback,
          0,
          "Acme-CallbackBridge",
        );
      },
    };
  },
});
```

### 8.2 stateful field bridge module

```ts
import { defineModule } from "@arktaint/module";

export default defineModule({
  id: "acme.field_bridge",
  description: "Bridge Remember(box, value) into box.saved.",

  setup() {
    return {
      onInvoke(event) {
        if (!event.call.matchesMethod("Remember")) return;

        const target = event.values.arg(0);
        const payload = event.values.arg(1);
        if (!target || !payload) return;

        if (!event.match.arg(1)) return;

        return event.emit.toValueField(
          target,
          ["saved"],
          "Acme-FieldBridge",
          { anchorStmt: event.raw.stmt },
        );
      },
    };
  },
});
```

## 9. setup 阶段复杂扫描模板

如果语义不是单纯 invoke 当场桥接，而是需要先扫调用点、字段 load/store 或装饰器，再建立模型，优先用 `ctx.scan` 和 `ctx.bridge`。

示意：

```ts
import { defineModule } from "@arktaint/module";

export default defineModule({
  id: "acme.precomputed_bridge",
  description: "Precompute a bridge during setup.",

  setup(ctx) {
    const relay = ctx.bridge.nodeRelay();

    for (const call of ctx.scan.invokes({ methodName: "register" })) {
      relay.connectInvokeArgToCallbackParam(call, 0, 1, 0, {
        sourceKind: "carrier",
        maxCandidates: 8,
      });
    }

    return {
      onFact(event) {
        return relay.emitPreserve(event, "Acme-PrecomputedBridge", {
          allowUnreachableTarget: true,
        });
      },
    };
  },
});
```

如果你发现自己又开始直接遍历大量底层 IR 类型，先想想能不能换成：

- `ctx.methods`
- `ctx.scan.*`
- `ctx.bridge.*`
- `ctx.callbacks.*`

## 10. 如何调试 module

### 10.1 列出 module projects

```bash
node out/cli/analyze.js --repo <repo> --module-root <dir> --list-module-projects
```

### 10.2 列出 modules

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --module-root <dir> \
  --enable-module-project acme_sdk \
  --list-modules
```

### 10.3 解释某个 module

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --module-root <dir> \
  --enable-module-project acme_sdk \
  --explain-module acme.callback_bridge
```

### 10.4 跟踪某个 module

```bash
node out/cli/analyze.js \
  --repo <repo> \
  --sourceDir <sourceDir> \
  --module-root <dir> \
  --enable-module-project acme_sdk \
  --trace-module acme.callback_bridge
```

`--trace-module` 重点看：

- module 是否加载
- hook 调用了多少次
- 发了多少 emission
- 最近 hit / skip / log 消息是什么

## 11. 推荐工作流

1. 先确认 rules 确实不够表达
2. 在 `project/<id>/` 下新建一个 `.ts`
3. 使用 `@arktaint/module` 编写 module
4. 先用高层 API 写
5. 只有高层 API 不够时才下钻 `raw`
6. 配一个最小正例 `T`
7. 配一个最小反例 `F`
8. 先跑小样例，再跑大 benchmark
9. 用 `--trace-module` 确认 hook 与 emission 是否符合预期

## 12. 什么时候该改引擎而不是改 module

如果你发现自己反复需要：

- 改 `ModuleRuntime`
- 改 `TaintPropagationEngine`
- 改 `SinkDetector`
- 新增一类通用 bridge 原语

那通常说明：

> 不是 project module 该直接碰引擎，
> 而是平台的公开 author API 还不够。

原则：

- `project` module 只用公开 API
- 不够用时，先补 author API，再写 project module
- 不要为了某个具体陌生 API 直接把私有 kernel 逻辑重新拉回 module

## 13. 常见错误

### 错误 1：直接 import 私有内部实现

例如导入：

- `src/core/orchestration/modules/...`
- `src/core/kernel/...`

对于 `project` module，loader 会拒绝加载。

### 错误 2：能用 `event.match.*` 还手动对齐当前 fact

优先使用：

- `event.match.arg(index)`
- `event.match.base()`
- `event.match.result()`

只有它不够时再自己下钻做更细的 node 过滤。

### 错误 3：能用 callback helper 还手搓 callback 解析

优先使用：

- `ctx.callbacks.*`
- `event.callbacks.*`

只有它不够时再下钻。

### 错误 4：一上来就写巨大的 module

先把语义拆成：

- 一个最小桥接点
- 一个最小 T/F 夹具

确认最小语义成立后再扩展。

## 14. 示例位置

可参考：

- `examples/module/demo-module/demo.ts`
- `src/modules/kernel/harmony/router.ts`
- `src/modules/kernel/harmony/state.ts`
- `src/modules/kernel/harmony/ability_handoff.ts`
- `src/tests/analyze/test_analyze_module_callback_api.ts`
- `src/tests/analyze/test_analyze_module_field_bridge_api.ts`
- `src/tests/runtime/test_module_runtime.ts`
