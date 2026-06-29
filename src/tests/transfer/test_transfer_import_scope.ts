import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import type { AssetDocumentBase, SemanticEffectTemplate } from "../../core/assets/schema";
import type { ApiEffectIdentity } from "../../core/api/ApiOccurrenceIdentity";
import { canonicalApiDescriptorFromTestDeclaration, indexedTestParameters } from "../helpers/CanonicalApiTestDeclarations";
import type { CanonicalApiDescriptor } from "../../core/api/identity";
import { exactRuleRuntimeFromAssets, exactSinkRule, type ExactRuleRuntime } from "../rules/ExactRuleTestUtils";
import {
    assertCanonicalExactRules,
} from "./ExactTransferTestUtils";
import * as path from "path";

interface CaseSpec {
    methodName: string;
    expected: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
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

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findMethod(scene: Scene, methodName: string, signatureHint?: string) {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && (!signatureHint || m.getSignature?.().toString?.().includes(signatureHint))
    );
    assert(method, `method not found: ${methodName}${signatureHint ? ` (${signatureHint})` : ""}`);
    return method;
}

function axiosGetTransferAsset(): {
    asset: AssetDocumentBase;
    descriptor: CanonicalApiDescriptor;
    rule: TransferRule;
} {
    const id = "transfer.test.ohos_axios_get.arg0_to_result";
    const descriptor = canonicalApiDescriptorFromTestDeclaration({
        authority: "third_party",
        domain: "npm",
        moduleSpecifier: "@ohos/axios",
        logicalDeclarationFile: "node_modules/@ohos/axios/index.d.ts",
        exportPath: [{ kind: "default", name: "axios" }],
        declarationOwner: {
            kind: "namespace",
            path: ["axios"],
            normalizedName: "axios",
        },
        member: {
            kind: "function",
            name: "get",
        },
        invoke: { kind: "call" },
        signature: {
            parameters: indexedTestParameters(["string"]),
            returnType: { text: "Promise<AxiosResponse>" },
        },
        declarationLocations: [{ file: "node_modules/@ohos/axios/index.d.ts" }],
    });
    const assetId = `asset.test.${id}`;
    const surfaceId = `surface.test.${id}`;
    const bindingId = `binding.test.${id}`;
    const effectTemplateId = `template.test.${id}`;
    const apiEffect: ApiEffectIdentity = {
        canonicalApiId: descriptor.canonicalApiId,
        assetId,
        surfaceId,
        bindingId,
        effectTemplateId,
        role: "transfer",
    };
    const template: SemanticEffectTemplate = {
        id: effectTemplateId,
        kind: "rule.transfer",
        from: { base: { kind: "arg", index: 0 } },
        to: { base: { kind: "return" } },
        transferKind: "test",
        confidence: "certain",
    };
    const asset: AssetDocumentBase = {
        id: assetId,
        plane: "rule",
        status: "reviewed",
        surfaces: [{
            surfaceId,
            kind: "invoke",
            canonicalApiId: descriptor.canonicalApiId,
            confidence: "certain",
            provenance: { source: "manual" },
        }],
        bindings: [{
            bindingId,
            surfaceId,
            assetId,
            plane: "rule",
            role: "transfer",
            canonicalApiId: descriptor.canonicalApiId,
            endpoint: { base: { kind: "return" } },
            effectTemplateRefs: [effectTemplateId],
            semanticsFamily: "test-transfer",
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [template],
        provenance: { source: "project" },
    };
    return {
        asset,
        descriptor,
        rule: {
            id,
            match: { kind: "canonical_api_id_equals", value: descriptor.canonicalApiId },
            apiEffect,
            from: "arg0",
            to: "result",
        },
    };
}

async function runCase(
    scene: Scene,
    methodName: string,
    sinkRules: SinkRule[],
    transferRules: TransferRule[],
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1, { ...runtime, transferRules, includeBuiltinModules: false });
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
    const sourceDir = path.resolve("tests/demo/transfer_import_scope");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkEffect = exactSinkRule({
        id: "sink.test.arg0",
        method: findMethod(scene, "Sink"),
        target: { endpoint: "arg0" },
    });
    const transferEffect = axiosGetTransferAsset();
    const sinkRules: SinkRule[] = [sinkEffect.rule];
    const transferRules: TransferRule[] = [transferEffect.rule];
    assertCanonicalExactRules([...sinkRules, ...transferRules]);
    const exactRuntime = exactRuleRuntimeFromAssets(
        [sinkEffect.asset, transferEffect.asset],
        [sinkEffect.exact.canonicalApiDescriptor, transferEffect.descriptor],
    );

    const cases: CaseSpec[] = [
        { methodName: "transfer_import_scope_001_T", expected: true },
        { methodName: "transfer_import_scope_002_F", expected: false },
    ];

    let passCount = 0;
    for (const item of cases) {
        const detected = await runCase(scene, item.methodName, sinkRules, transferRules, exactRuntime);
        const pass = detected === item.expected;
        if (pass) passCount++;
        console.log(`${pass ? "PASS" : "FAIL"} ${item.methodName} expected=${item.expected} detected=${detected}`);
    }

    console.log("====== Transfer Import Scope Test ======");
    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);

    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
