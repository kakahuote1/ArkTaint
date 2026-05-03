# ArkTaint 前端控制台

这个目录是 ArkTaint 的独立前端与本地桥接服务。前端负责产品介绍、参数配置、运行状态和实时日志展示；真正的静态分析仍由所选 ArkTaint CLI 根目录执行。

## 启动方式

先启动本地桥接服务：

```powershell
cd D:\cursor\workplace\ArkTaint\arktaint-frontend
node server.js
```

再启动前端页面：

```powershell
cd D:\cursor\workplace\ArkTaint\arktaint-frontend
npm run dev
```

默认访问地址：

```text
http://localhost:5173
```

## 可选环境变量

```powershell
$env:ARKTAINT_ROOT="D:\cursor\workplace\ArkTaint"
$env:ARKTAINT_BRIDGE_PORT="3001"
$env:VITE_ARKTAINT_BRIDGE_URL="http://localhost:3001"
```

## 使用建议

- `ArkTaint 根目录` 指向包含 `package.json` 和 `npm run analyze` 的 ArkTaint 工程。
- `目标项目目录` 指向待分析的 HarmonyOS/ArkTS 项目。
- `源码目录` 建议优先填写 `entry/src/main/ets`，避免同时分析项目根目录和 entry 目录造成重复统计。
- 需要完整流路径和核查信息时，将报告模式设为 `完整`。
- 需要大模型辅助识别未知 API 时，开启 `SemanticFlow` 并选择对应的大模型配置名。
