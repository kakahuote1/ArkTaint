import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import type { AssetDocumentBase, SemanticEffectTemplate } from "../../core/assets/schema";
import type { ApiEffectIdentity } from "../../core/api/ApiOccurrenceIdentity";
import type { CanonicalApiDescriptor } from "../../core/api/identity";
import { createDefaultCanonicalApiRegistry } from "../../core/api/identity";
import { canonicalApiDescriptorFromTestDeclaration, indexedTestParameters } from "../helpers/CanonicalApiTestDeclarations";
import * as path from "path";
import { exactRuleRuntimeFromAssets, type ExactRuleRuntime } from "./ExactRuleTestUtils";

interface CaseSpec {
    methodName: string;
    expected: boolean;
}

type ExactSinkRuntime = ExactRuleRuntime & {
    sinkRules: SinkRule[];
};

const OFFICIAL_WEBVIEW_RUN_JAVASCRIPT =
    "api:official:openharmony:module=%40ohos.web.webview:file=api%2F%40ohos.web.webview.d.ts:export=namespace%3Awebview.WebviewController:decl=class%3Awebview.WebviewController:member=method%3Ainstance%3ArunJavaScript:invoke=call:params=0%3Astring:ret=Promise%3Cstring%3E";

interface ExactSinkAsset {
    asset: AssetDocumentBase;
    descriptor: CanonicalApiDescriptor;
    rule: SinkRule;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function exactSdkSinkAsset(input: {
    id: string;
    descriptor: CanonicalApiDescriptor;
    target: "arg0";
}): ExactSinkAsset {
    const assetId = `asset.test.${input.id}`;
    const surfaceId = `surface.test.${input.id}`;
    const bindingId = `binding.test.${input.id}`;
    const effectTemplateId = `template.test.${input.id}`;
    const endpoint = { base: { kind: "arg" as const, index: 0 } };
    const apiEffect: ApiEffectIdentity = {
        canonicalApiId: input.descriptor.canonicalApiId,
        assetId,
        surfaceId,
        bindingId,
        effectTemplateId,
        role: "sink",
    };
    const template: SemanticEffectTemplate = {
        id: effectTemplateId,
        kind: "rule.sink",
        value: endpoint,
        sinkKind: "test",
        confidence: "certain",
    };
    const asset: AssetDocumentBase = {
        id: assetId,
        plane: "rule",
        status: "reviewed",
        surfaces: [{
            surfaceId,
            kind: "invoke",
            canonicalApiId: input.descriptor.canonicalApiId,
            confidence: "certain",
            provenance: { source: "manual" },
        }],
        bindings: [{
            bindingId,
            surfaceId,
            assetId,
            plane: "rule",
            role: "sink",
            canonicalApiId: input.descriptor.canonicalApiId,
            endpoint,
            effectTemplateRefs: [effectTemplateId],
            semanticsFamily: "test-sink",
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [template],
        provenance: { source: "project" },
    };
    return {
        asset,
        descriptor: input.descriptor,
        rule: {
            id: input.id,
            target: input.target,
            match: { kind: "canonical_api_id_equals", value: input.descriptor.canonicalApiId },
            apiEffect,
        },
    };
}

function requireDefaultDescriptor(canonicalApiId: string): CanonicalApiDescriptor {
    const descriptor = createDefaultCanonicalApiRegistry().get(canonicalApiId);
    assert(descriptor, `default canonical descriptor missing: ${canonicalApiId}`);
    return descriptor;
}

function webviewRunJavaScriptDescriptor(moduleSpecifier: "@ohos.web.webview" | "@kit.ArkWeb"): CanonicalApiDescriptor {
    if (moduleSpecifier === "@ohos.web.webview") {
        return requireDefaultDescriptor(OFFICIAL_WEBVIEW_RUN_JAVASCRIPT);
    }
    return canonicalApiDescriptorFromTestDeclaration({
        authority: "official",
        domain: "openharmony",
        moduleSpecifier,
        logicalDeclarationFile: "api/@kit.ArkWeb.d.ts",
        exportPath: [{ kind: "named", name: "webview" }],
        declarationOwner: {
            kind: "class",
            path: ["webview", "WebviewController"],
            normalizedName: "webview.WebviewController",
        },
        member: {
            kind: "method",
            name: "runJavaScript",
            static: false,
        },
        invoke: { kind: "call" },
        signature: {
            parameters: indexedTestParameters(["string"]),
            returnType: { text: "Promise<string>" },
        },
        declarationLocations: [{ file: "api/@kit.ArkWeb.d.ts" }],
    });
}

function buildExactSinkRuntime(sinks: ExactSinkAsset[]): ExactSinkRuntime {
    for (const sink of sinks) {
        assert(sink.rule.match.kind === "canonical_api_id_equals", `${sink.rule.id}: expected canonical exact match`);
        assert(sink.rule.match.value === sink.rule.apiEffect.canonicalApiId, `${sink.rule.id}: match value must equal apiEffect canonicalApiId`);
    }
    const runtime = exactRuleRuntimeFromAssets(
        sinks.map(sink => sink.asset),
        sinks.map(sink => sink.descriptor),
    );
    return {
        ...runtime,
        sinkRules: sinks.map(sink => sink.rule),
    };
}

function findSeedNodes(engine: TaintPropagationEngine, scene: any, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find((m: any) => m.getName() === methodName);
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

async function runCase(scene: any, methodName: string, runtime: ExactSinkRuntime): Promise<boolean> {
    const entryMethod = scene.getMethods().find((m: any) => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1, {
        ...runtime,
        includeBuiltinModules: false,
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedNodes = findSeedNodes(engine, scene, methodName, "taint_src");
    assert(seedNodes.length > 0, `${methodName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(runtime.sinkRules);
    return flows.length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/webview_bridge_scope");
    const scene = buildTestScene(sourceDir);

    const sinkRuntime = buildExactSinkRuntime([
        exactSdkSinkAsset({
            id: "sink.test.ohos_webview.runJavaScript.arg0",
            descriptor: webviewRunJavaScriptDescriptor("@ohos.web.webview"),
            target: "arg0",
        }),
        exactSdkSinkAsset({
            id: "sink.test.kit_arkweb.runJavaScript.arg0",
            descriptor: webviewRunJavaScriptDescriptor("@kit.ArkWeb"),
            target: "arg0",
        }),
    ]);

    const cases: CaseSpec[] = [
        { methodName: "webview_bridge_scope_001_T", expected: true },
        { methodName: "webview_bridge_scope_002_F", expected: false },
        { methodName: "webview_bridge_scope_003_T", expected: true },
        { methodName: "webview_bridge_scope_004_T", expected: true },
    ];

    let passCount = 0;
    for (const item of cases) {
        const detected = await runCase(scene, item.methodName, sinkRuntime);
        const pass = detected === item.expected;
        if (pass) passCount++;
        console.log(`${pass ? "PASS" : "FAIL"} ${item.methodName} expected=${item.expected} detected=${detected}`);
    }

    console.log("====== WebView Bridge Scope Test ======");
    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);

    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error("FAIL test_webview_bridge_scope");
    console.error(error);
    process.exitCode = 1;
});
