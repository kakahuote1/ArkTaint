import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

async function detectCase(scene: Scene, methodName: string, sinkRules: SinkRule[]): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedNodes = findSeedNodes(engine, scene, methodName, "taint_src");
    assert(seedNodes.length > 0, `${methodName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, methodName));
    return flows.length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/sink_callee_scope");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkRules: SinkRule[] = [
        {
            id: "sink.test.http_request_scope.arg0",
            match: {
                kind: "method_name_equals",
                value: "request",
                invokeKind: "instance",
                argCount: 1,
            },
            scope: {
                className: { mode: "contains", value: "HttpRequestHost" },
            },
            target: { endpoint: "arg0" },
        },
    ];

    const httpDetected = await detectCase(scene, "http_request_scope_001_T", sinkRules);
    const lockDetected = await detectCase(scene, "async_lock_request_scope_002_F", sinkRules);

    const webviewRules: SinkRule[] = [
        {
            id: "sink.test.webview_runjs_scope.arg0",
            match: {
                kind: "method_name_equals",
                value: "runJavaScript",
                invokeKind: "instance",
                argCount: 1,
            },
            scope: {
                className: { mode: "regex", value: "^(WebController|WebviewController|AtomicServiceWebController)$" },
            },
            target: { endpoint: "arg0" },
        },
    ];
    const fileioRules: SinkRule[] = [
        {
            id: "sink.test.fileio_write_sync_scope.arg1",
            match: {
                kind: "method_name_equals",
                value: "writeSync",
                invokeKind: "instance",
                argCount: 2,
            },
            scope: {
                className: { mode: "regex", value: "(fs|fileio|FileIo)" },
            },
            target: { endpoint: "arg1" },
        },
    ];
    const appAccountRules: SinkRule[] = [
        {
            id: "sink.test.appaccount_create_account.arg0",
            match: {
                kind: "method_name_equals",
                value: "createAccount",
                invokeKind: "instance",
                argCount: 1,
            },
            scope: {
                className: { mode: "regex", value: "(^|[^A-Za-z0-9_$])(AppAccountManager|appAccount|AppAccount)([^A-Za-z0-9_$]|$)" },
            },
            target: { endpoint: "arg0" },
        },
        {
            id: "sink.test.appaccount_set_credential.arg2",
            match: {
                kind: "method_name_equals",
                value: "setCredential",
                invokeKind: "instance",
                argCount: 3,
            },
            scope: {
                className: { mode: "regex", value: "(^|[^A-Za-z0-9_$])(AppAccountManager|appAccount|AppAccount)([^A-Za-z0-9_$]|$)" },
            },
            target: { endpoint: "arg2" },
        },
    ];
    const webviewDetected = await detectCase(scene, "webview_controller_sdk_field_scope_003_T", webviewRules);
    const fileioDetected = await detectCase(scene, "fileio_write_sync_sdk_import_004_T", fileioRules);
    const appAccountDetected = await detectCase(scene, "appaccount_manager_sdk_scope_005_T", appAccountRules);
    const projectAccountDetected = await detectCase(scene, "project_account_manager_scope_006_F", appAccountRules);

    console.log("====== Sink Callee Scope Test ======");
    console.log(`http_request_detected=${httpDetected}`);
    console.log(`async_lock_request_detected=${lockDetected}`);
    console.log(`webview_runjs_detected=${webviewDetected}`);
    console.log(`fileio_write_sync_detected=${fileioDetected}`);
    console.log(`appaccount_detected=${appAccountDetected}`);
    console.log(`project_account_detected=${projectAccountDetected}`);

    assert(httpDetected, "expected scoped HTTP request sink to be detected");
    assert(!lockDetected, "expected non-HTTP request method to be rejected by callee scope");
    assert(webviewDetected, "expected SDK field-typed WebviewController.runJavaScript sink to be detected");
    assert(fileioDetected, "expected SDK import-rooted fileio.writeSync sink to be detected");
    assert(appAccountDetected, "expected SDK appAccount manager credential sink to be detected");
    assert(!projectAccountDetected, "expected project account manager methods to be rejected by appAccount scope");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
