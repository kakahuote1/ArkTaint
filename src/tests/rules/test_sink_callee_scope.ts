import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule } from "../../core/rules/RuleSchema";
import { loadRuleSet, type LoadedRuleSet } from "../../core/rules/RuleLoader";
import * as path from "path";
import { exactRuleRuntimeFromFixtures, exactSinkRule, type ExactRuleRuntime } from "./ExactRuleTestUtils";

const OFFICIAL_WEBVIEW_RUN_JAVASCRIPT =
    "api:official:openharmony:module=%40ohos.web.webview:file=api%2F%40ohos.web.webview.d.ts:export=namespace%3Awebview.WebviewController:decl=class%3Awebview.WebviewController:member=method%3Ainstance%3ArunJavaScript:invoke=call:params=0%3Astring:ret=Promise%3Cstring%3E";
const OFFICIAL_FILE_FS_WRITE_SYNC = [
    "api:official:openharmony:module=%40ohos.file.fs:file=api%2F%40ohos.file.fs.d.ets:export=default%3AfileIo:decl=namespace%3AfileIo:member=function%3AwriteSync:invoke=call:params=0%3Anumber%2C1%3AArrayBuffer%20%7C%20string%2C2%3A%3F%3AWriteOptions:ret=number",
    "api:official:openharmony:module=%40ohos.file.fs:file=api%2F%40ohos.file.fs.d.ts:export=default%3AfileIo:decl=function%3AwriteSync:member=function%3AwriteSync:invoke=call:params=0%3Anumber%2C1%3AArrayBuffer%20%7C%20string%2C2%3A%3F%3AWriteOptions:ret=number",
];
const OFFICIAL_APPACCOUNT_SET_CREDENTIAL =
    "api:official:openharmony:module=%40ohos.account.appAccount:file=api%2F%40ohos.account.appAccount.d.ts:export=namespace%3AappAccount.AppAccountManager:decl=interface%3AappAccount.AppAccountManager:member=method%3Ainstance%3AsetCredential:invoke=call:params=0%3Astring%2C1%3Astring%2C2%3Astring:ret=Promise%3Cvoid%3E";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findMethod(scene: Scene, methodName: string, signatureHint: string): any {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getSignature?.().toString?.().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method;
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

async function detectCase(
    scene: Scene,
    methodName: string,
    sinkRules: SinkRule[],
    exactRuntime: ExactRuleRuntime,
): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1, exactRuntime);
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

function officialExactRuntime(loaded: LoadedRuleSet): ExactRuleRuntime {
    return {
        apiAssets: loaded.assets,
        canonicalApiRegistry: loaded.canonicalApiRegistry,
        assetIdentityIndex: loaded.assetIdentityIndex,
    };
}

function officialSinkRules(loaded: LoadedRuleSet, canonicalApiIds: readonly string[]): SinkRule[] {
    const allowed = new Set(canonicalApiIds);
    const rules = (loaded.ruleSet.sinks || []).filter(rule =>
        rule.match.kind === "canonical_api_id_equals"
        && rule.apiEffect?.canonicalApiId
        && allowed.has(rule.apiEffect.canonicalApiId)
    );
    assert(rules.length > 0, `official sink rules not found for: ${canonicalApiIds.join(", ")}`);
    for (const rule of rules) {
        assert(rule.match.value === rule.apiEffect?.canonicalApiId, `${rule.id}: match must equal apiEffect canonicalApiId`);
    }
    return rules;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/sink_callee_scope");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    const officialRules = loadRuleSet({ ruleCatalogPath: path.resolve("src/models") });
    const officialRuntime = officialExactRuntime(officialRules);

    const httpSink = exactSinkRule({
        id: "sink.test.http_request_scope.arg0",
        method: findMethod(scene, "request", "HttpRequestHost"),
        target: "arg0",
    });
    const sinkRules: SinkRule[] = [httpSink.rule];
    const httpRuntime = exactRuleRuntimeFromFixtures([httpSink]);

    const httpDetected = await detectCase(scene, "http_request_scope_001_T", sinkRules, httpRuntime);
    const lockDetected = await detectCase(scene, "async_lock_request_scope_002_F", sinkRules, httpRuntime);

    const webviewRules = officialSinkRules(officialRules, [OFFICIAL_WEBVIEW_RUN_JAVASCRIPT]);
    const fileioRules = officialSinkRules(officialRules, OFFICIAL_FILE_FS_WRITE_SYNC);
    const appAccountRules = officialSinkRules(officialRules, [OFFICIAL_APPACCOUNT_SET_CREDENTIAL]);
    const webviewDetected = await detectCase(scene, "webview_controller_sdk_field_scope_003_T", webviewRules, officialRuntime);
    const fileioDetected = await detectCase(scene, "fileio_write_sync_sdk_import_004_T", fileioRules, officialRuntime);
    const appAccountDetected = await detectCase(scene, "appaccount_manager_sdk_scope_005_T", appAccountRules, officialRuntime);
    const projectAccountDetected = await detectCase(scene, "project_account_manager_scope_006_F", appAccountRules, officialRuntime);

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
    assert(fileioDetected, "expected SDK import-rooted fileIo.writeSync sink to be detected");
    assert(appAccountDetected, "expected SDK appAccount setCredential sink to be detected");
    assert(!projectAccountDetected, "expected project account manager methods to be rejected by appAccount scope");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
