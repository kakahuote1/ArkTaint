import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { collectCaseSeedNodes } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function buildFixture(repoRoot: string): void {
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    writeText(path.join(sourceDir, "Sink.ets"), [
        "export function sendProbe(_value: string): void {}",
        "",
    ].join("\n"));
    writeText(path.join(sourceDir, "SingletonProbe.ets"), [
        "import { sendProbe } from './Sink';",
        "",
        "class ProbeDispatcher {",
        "  run(value: string): void {",
        "    sendProbe(value);",
        "  }",
        "}",
        "",
        "const dispatcher = new ProbeDispatcher();",
        "export default dispatcher;",
        "",
    ].join("\n"));
    writeText(path.join(sourceDir, "EntryAbility.ets"), [
        "import { sendProbe } from './Sink';",
        "import dispatcher from './SingletonProbe';",
        "",
        "function relay(value: string): string {",
        "  return value;",
        "}",
        "",
        "async function asyncRelay(value: string): Promise<string> {",
        "  const returned = relay(value);",
        "  return Promise.resolve(returned);",
        "}",
        "",
        "function registerValue(value: string, cb: (payload: string) => void): void {",
        "  cb(value);",
        "}",
        "",
        "function registerPromiseValue(value: string): Promise<string> {",
        "  return Promise.resolve(value);",
        "}",
        "",
        "function parseTokenLine(line: string): string {",
        "  const parts = line.split('=');",
        "  return decodeURIComponent(parts[1]);",
        "}",
        "",
        "function buildDto(value: string): { token: string, role: string } {",
        "  return {",
        "    token: value,",
        "    role: 'clean',",
        "  };",
        "}",
        "",
        "function readDtoToken(dto: { token: string, role: string }): string {",
        "  return dto.token;",
        "}",
        "",
        "class FieldRelay {",
        "  private slot: string = '';",
        "",
        "  capture(value: string): void {",
        "    this.slot = value;",
        "  }",
        "",
        "  flush(): void {",
        "    sendProbe(this.slot);",
        "  }",
        "}",
        "",
        "interface DispatchTarget {",
        "  handle(value: string): void;",
        "}",
        "",
        "class TaintedDispatchTarget implements DispatchTarget {",
        "  handle(value: string): void {",
        "    sendProbe(value);",
        "  }",
        "}",
        "",
        "class CleanDispatchTarget implements DispatchTarget {",
        "  handle(_value: string): void {",
        "    sendProbe('clean');",
        "  }",
        "}",
        "",
        "class HolderDispatchTarget implements DispatchTarget {",
        "  handle(value: string): void {",
        "    sendProbe(value);",
        "  }",
        "}",
        "",
        "function chooseTarget(flag: boolean): DispatchTarget {",
        "  if (flag) {",
        "    return new TaintedDispatchTarget();",
        "  }",
        "  return new CleanDispatchTarget();",
        "}",
        "",
        "function createUnresolvedTarget(): any {",
        "  return {};",
        "}",
        "",
        "function createTarget(): DispatchTarget {",
        "  return new TaintedDispatchTarget();",
        "}",
        "",
        "class TargetHolder {",
        "  private current: DispatchTarget = new HolderDispatchTarget();",
        "",
        "  getCurrent(): DispatchTarget {",
        "    return this.current;",
        "  }",
        "}",
        "",
        "function unknownFlag(): boolean {",
        "  return Date.now() > 0;",
        "}",
        "",
        "export function wrapper_arg_return_probe_T(taint_src: string): void {",
        "  const viaReturn = relay(taint_src);",
        "  sendProbe(viaReturn);",
        "}",
        "",
        "export async function promise_await_result_probe_T(taint_src: string): Promise<void> {",
        "  const pending = asyncRelay(taint_src);",
        "  const viaAwait = await pending;",
        "  sendProbe(viaAwait);",
        "}",
        "",
        "export async function promise_await_clean_probe_F(taint_src: string): Promise<void> {",
        "  const pending = asyncRelay('clean');",
        "  const viaAwait = await pending;",
        "  sendProbe(viaAwait);",
        "}",
        "",
        "export function callback_invocation_probe_T(taint_src: string): void {",
        "  registerValue(taint_src, (payload: string): void => {",
        "    sendProbe(payload);",
        "  });",
        "}",
        "",
        "export function promise_then_callback_probe_T(taint_src: string): void {",
        "  registerPromiseValue(taint_src).then((payload: string): void => {",
        "    sendProbe(payload);",
        "  });",
        "}",
        "",
        "export function this_field_probe_T(taint_src: string): void {",
        "  const carrier = new FieldRelay();",
        "  carrier.capture(taint_src);",
        "  carrier.flush();",
        "}",
        "",
        "export function dto_object_field_probe_T(taint_src: string): void {",
        "  const dto = buildDto(taint_src);",
        "  const token = readDtoToken(dto);",
        "  sendProbe(token);",
        "}",
        "",
        "export function array_higher_order_probe_T(taint_src: string): void {",
        "  const sourceValues: string[] = [];",
        "  sourceValues.push(taint_src);",
        "  sourceValues.push('clean');",
        "  const mapped = sourceValues.map((item: string): string => `${item}`);",
        "  const selected = mapped.filter((item: string): boolean => item.length > 0);",
        "  sendProbe(selected[0]);",
        "}",
        "",
        "export function map_set_slot_probe_T(taint_src: string): void {",
        "  const map = new Map<string, string>();",
        "  map.set('map-key', taint_src);",
        "  const mapped = map.get('map-key')!;",
        "  const set = new Set<string>();",
        "  set.add(mapped);",
        "  const values = Array.from(set.values());",
        "  sendProbe(values[0]);",
        "}",
        "",
        "export function json_string_url_parser_probe_T(taint_src: string): void {",
        "  const dto = { token: taint_src, role: 'clean' };",
        "  const json = JSON.stringify(dto);",
        "  const parsed = JSON.parse(json);",
        "  const line = `token=${encodeURIComponent(parsed.token)}`;",
        "  const decoded = parseTokenLine(line);",
        "  sendProbe(decoded);",
        "}",
        "",
        "export function singleton_default_export_receiver_probe_T(taint_src: string): void {",
        "  dispatcher.run(taint_src);",
        "}",
        "",
        "export function singleton_default_export_receiver_clean_probe_F(taint_src: string): void {",
        "  dispatcher.run('clean');",
        "}",
        "",
        "export function interface_dispatch_factory_return_probe_T(taint_src: string): void {",
        "  const target = createTarget();",
        "  target.handle(taint_src);",
        "}",
        "",
        "export function interface_dispatch_this_field_getter_probe_T(taint_src: string): void {",
        "  const holder = new TargetHolder();",
        "  const target = holder.getCurrent();",
        "  target.handle(taint_src);",
        "}",
        "",
        "export function virtual_dispatch_unresolved_probe_F(taint_src: string): void {",
        "  const target = createUnresolvedTarget();",
        "  target.handle(taint_src);",
        "}",
        "",
    ].join("\n"));
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function findMethod(scene: Scene, name: string): ArkMethod {
    const candidates = scene.getMethods().filter(method => method.getName?.() === name);
    assert(candidates.length === 1, `expected one method named ${name}, got ${candidates.length}`);
    return candidates[0];
}

function isSendProbeInvoke(invokeExpr: any): boolean {
    const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "sendProbe" || signature.includes("sendProbe(");
}

function collectTaintedSendProbeArgCount(engine: TaintPropagationEngine): number {
    const pag = engine.pag;
    const tracker = (engine as any).tracker;
    assert(pag, "engine PAG should be built");
    assert(tracker, "engine tracker should exist");

    let count = 0;
    for (const method of (engine as any).scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!isSendProbeInvoke(invokeExpr)) continue;
            const arg = invokeExpr.getArgs?.()[0];
            if (!arg) continue;
            const nodeIds = pag.getNodesByValue(arg);
            if (!nodeIds) continue;
            for (const nodeId of nodeIds.values()) {
                if (tracker.isTaintedAnyContext(nodeId) || tracker.hasAnyFieldTaintAnyContext(nodeId)) {
                    count += 1;
                    break;
                }
            }
        }
    }
    return count;
}

interface ProbeResult {
    taintedSinkArgs: number;
    callEdgeLedger: any[];
}

async function runProbeWithLedger(scene: Scene, entryName: string): Promise<ProbeResult> {
    const entryMethod = findMethod(scene, entryName);
    const engine = new TaintPropagationEngine(scene, 1, { includeBuiltinModules: false });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seeds = collectCaseSeedNodes(engine, entryMethod, {
        sourceLocalNames: [],
        includeParameterLocals: true,
    });
    assert(seeds.length > 0, `${entryName} should expose a seedable entry parameter`);
    engine.propagateWithSeeds(seeds);
    return {
        taintedSinkArgs: collectTaintedSendProbeArgCount(engine),
        callEdgeLedger: engine.getCallEdgeMaterializationLedger(),
    };
}

async function runProbe(scene: Scene, entryName: string): Promise<number> {
    return (await runProbeWithLedger(scene, entryName)).taintedSinkArgs;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "c4_ordinary_reachability_probes");
    const repoRoot = resolveTestRunPath("analyze", "c4_ordinary_reachability_probes", "fixtures", "repo");
    fs.rmSync(root, { recursive: true, force: true });
    buildFixture(repoRoot);

    const scene = buildScene(repoRoot);
    const positiveEntries = [
        "wrapper_arg_return_probe_T",
        "promise_await_result_probe_T",
        "callback_invocation_probe_T",
        "promise_then_callback_probe_T",
        "this_field_probe_T",
        "dto_object_field_probe_T",
        "array_higher_order_probe_T",
        "map_set_slot_probe_T",
        "json_string_url_parser_probe_T",
        "singleton_default_export_receiver_probe_T",
        "interface_dispatch_factory_return_probe_T",
        "interface_dispatch_this_field_getter_probe_T",
    ];

    const failures: string[] = [];
    for (const entryName of positiveEntries) {
        try {
            const taintedSinkArgs = await runProbe(scene, entryName);
            console.log(`${entryName}_tainted_sink_args=${taintedSinkArgs}`);
            assert(taintedSinkArgs > 0, `${entryName} should taint at least one sendProbe argument`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${entryName}: ${message}`);
        }
    }

    const negativeEntries = [
        "promise_await_clean_probe_F",
        "singleton_default_export_receiver_clean_probe_F",
        "virtual_dispatch_unresolved_probe_F",
    ];
    for (const entryName of negativeEntries) {
        try {
            const taintedSinkArgs = await runProbe(scene, entryName);
            console.log(`${entryName}_tainted_sink_args=${taintedSinkArgs}`);
            assert(taintedSinkArgs === 0, `${entryName} must not taint sendProbe arguments`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${entryName}: ${message}`);
        }
    }

    try {
        const promiseEntry = findMethod(scene, "promise_await_result_probe_T");
        const asyncRelayMethod = findMethod(scene, "asyncRelay");
        const promiseResult = await runProbeWithLedger(scene, "promise_await_result_probe_T");
        assert(
            promiseResult.callEdgeLedger.some(row =>
                row.status === "built"
                && row.edgeKind === "return_to_assignment"
                && row.callerSignature === promiseEntry.getSignature().toString()
                && row.calleeSignature === asyncRelayMethod.getSignature().toString()
                && Number(row.builtEdgeCount || 0) > 0,
            ),
            "promise await result should materialize an exact return_to_assignment edge",
        );

        const entryMethod = findMethod(scene, "singleton_default_export_receiver_probe_T");
        const runMethod = findMethod(scene, "run");
        const singletonResult = await runProbeWithLedger(scene, "singleton_default_export_receiver_probe_T");
        assert(
            singletonResult.callEdgeLedger.some(row =>
                row.status === "built"
                && row.edgeKind === "arg_to_param"
                && row.callerSignature === entryMethod.getSignature().toString()
                && row.calleeSignature === runMethod.getSignature().toString()
                && Number(row.builtEdgeCount || 0) > 0,
            ),
            "singleton default-export receiver should materialize an exact arg_to_param edge",
        );

        const virtualEntry = findMethod(scene, "virtual_dispatch_unresolved_probe_F");
        const virtualResult = await runProbeWithLedger(scene, "virtual_dispatch_unresolved_probe_F");
        assert(
            virtualResult.callEdgeLedger.some(row =>
                row.status === "not_built"
                && row.reason === "virtual_dispatch_unresolved"
                && row.callerSignature === virtualEntry.getSignature().toString(),
            ),
            "unresolved virtual dispatch should leave an explainable blocked call-edge ledger row",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`call_edge_materialization_ledger: ${message}`);
    }

    if (failures.length === 0) {
        console.log("PASS test_c4_ordinary_reachability_probes");
    } else {
        console.log("FAIL test_c4_ordinary_reachability_probes");
        for (const failure of failures) {
            console.log(`failure=${failure}`);
        }
        throw new Error(`C4 ordinary reachability probes failed: ${failures.join(" | ")}`);
    }
}

main().catch(error => {
    console.error("FAIL test_c4_ordinary_reachability_probes");
    console.error(error);
    process.exitCode = 1;
});
