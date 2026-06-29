import * as fs from "fs";
import * as path from "path";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkanalyzerMethodKey } from "../../core/api/identity";
import { assertValidCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import { loadArkMainSeeds } from "../../core/entry/arkmain/ArkMainLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(sourceDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    return scene;
}

function writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
}

function findMethod(scene: Scene, methodName: string, declaringClassName?: string): ArkMethod {
    const method = scene.getMethods().find(item =>
        item.getName?.() === methodName
        && (!declaringClassName || item.getDeclaringArkClass?.()?.getName?.() === declaringClassName)
    );
    assert(method, `missing method ${declaringClassName ? `${declaringClassName}.` : ""}${methodName}`);
    return method;
}

function findInvokeMethodKey(caller: ArkMethod, invokedMethodName: string): ArkanalyzerMethodKey {
    const cfg = caller.getCfg?.();
    assert(cfg, `missing cfg for ${caller.getSignature?.()?.toString?.() || caller.getName?.()}`);
    for (const stmt of cfg.getStmts?.() || []) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        const actualName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.();
        if (actualName === invokedMethodName) {
            const key = methodKeyFromSignature(invokeExpr.getMethodSignature(), invokeExpr instanceof ArkStaticInvokeExpr);
            assertKnownMethodKey(key, `invoke ${invokedMethodName}`);
            return key;
        }
    }
    throw new Error(`missing invoke ${invokedMethodName}`);
}

function methodKeyFromMethod(method: ArkMethod): ArkanalyzerMethodKey {
    const signature = method.getSignature?.();
    assert(signature, `missing signature for ${method.getName?.()}`);
    const key = methodKeyFromSignature(signature, (method as any).isStatic?.() === true);
    assertKnownMethodKey(key, method.getName?.() || "<method>");
    return key;
}

function methodKeyFromSignature(signature: any, staticFlag: boolean): ArkanalyzerMethodKey {
    const declaringClass = signature.getDeclaringClassSignature?.();
    const subSignature = signature.getMethodSubSignature?.();
    return {
        declaringFileName: String(declaringClass?.getDeclaringFileSignature?.()?.toString?.() || "").trim(),
        declaringNamespacePath: namespacePathFromClassSignature(declaringClass),
        declaringClassName: String(declaringClass?.getClassName?.() || "").trim(),
        methodName: String(subSignature?.getMethodName?.() || "").trim(),
        parameterTypes: (subSignature?.getParameters?.() || []).map((param: any) => typeTextOf(param)),
        returnType: typeTextOf(subSignature?.getReturnType?.()),
        staticFlag,
    };
}

function assertKnownMethodKey(key: ArkanalyzerMethodKey, label: string): void {
    const fields = [
        key.declaringFileName,
        key.declaringClassName,
        key.methodName,
        key.returnType,
        ...key.parameterTypes,
    ];
    assert(fields.every(item => item && !String(item).includes("%unk")), `unknown method key for ${label}: ${JSON.stringify(key)}`);
}

function namespacePathFromClassSignature(declaringClass: any): string[] {
    const text = String(declaringClass?.getDeclaringNamespaceSignature?.()?.toString?.() || "")
        .replace(/\\/g, "/")
        .replace(/:\s*$/g, "")
        .trim();
    if (!text) return [];
    const colon = text.lastIndexOf(":");
    const namespaceText = (colon >= 0 ? text.slice(colon + 1) : text).trim();
    if (!namespaceText || namespaceText === "%dflt") return [];
    return namespaceText.split(".").map(part => part.trim()).filter(part => part.length > 0 && part !== "%dflt");
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "").trim();
}

function projectCanonicalApiId(logicalFile: string, key: ArkanalyzerMethodKey): string {
    const ownerPath = [...(key.declaringNamespacePath || []), key.declaringClassName].filter(Boolean).join(".");
    const params = key.parameterTypes.length === 0
        ? "none"
        : key.parameterTypes.map((type, index) => `${index}:${type}`).join(",");
    const id = [
        "api",
        "project",
        "local",
        `module=${encodeURIComponent(logicalFile)}`,
        `file=${encodeURIComponent(logicalFile)}`,
        `export=${encodeURIComponent(`namespace:${key.declaringClassName}`)}`,
        `decl=${encodeURIComponent(`class:${ownerPath}`)}`,
        `member=${encodeURIComponent(`method:${key.staticFlag ? "static" : "instance"}:${key.methodName}`)}`,
        "invoke=call",
        `params=${encodeURIComponent(params)}`,
        `ret=${encodeURIComponent(key.returnType)}`,
    ].join(":");
    assertValidCanonicalApiId(id);
    return id;
}

function makeArkMainAsset(input: {
    id: string;
    logicalFile: string;
    lifecycleKey: ArkanalyzerMethodKey;
    callbackRegisterKey?: ArkanalyzerMethodKey;
    callbackLocator?: any;
    omitLifecycleEvidence?: boolean;
    lifecycleEntryKind?: string;
}): any {
    const lifecycleCanonicalApiId = projectCanonicalApiId(input.logicalFile, input.lifecycleKey);
    const lifecycleSurfaceId = `surface:${lifecycleCanonicalApiId}`;
    const surfaces: any[] = [
        {
            surfaceId: lifecycleSurfaceId,
            canonicalApiId: lifecycleCanonicalApiId,
            kind: "invoke",
            confidence: "certain",
            provenance: { source: "manual", location: { file: input.logicalFile } },
        },
    ];
    if (!input.omitLifecycleEvidence) {
        surfaces[0].evidence = { arkanalyzer: { methodKey: input.lifecycleKey } };
    }
    const bindings: any[] = [
        {
            bindingId: `${input.id}.libraryPanel.build.binding`,
            surfaceId: lifecycleSurfaceId,
            canonicalApiId: lifecycleCanonicalApiId,
            assetId: input.id,
            plane: "arkmain",
            role: "entry",
            effectTemplateRefs: [`${input.id}.libraryPanel.build.effect`],
            semanticsFamily: "page_build",
            completeness: "complete",
            confidence: "certain",
        },
    ];
    const effectTemplates: any[] = [
        {
            id: `${input.id}.libraryPanel.build.effect`,
            kind: "entry.lifecycle",
            entryKind: input.lifecycleEntryKind || "page_build",
            phase: "composition",
            ownerKind: "component",
            entryShape: "method",
            confidence: "certain",
        },
    ];
    if (input.callbackRegisterKey) {
        const callbackCanonicalApiId = projectCanonicalApiId(input.logicalFile, input.callbackRegisterKey);
        const callbackSurfaceId = `surface:${callbackCanonicalApiId}`;
        surfaces.push({
            surfaceId: callbackSurfaceId,
            canonicalApiId: callbackCanonicalApiId,
            kind: "invoke",
            evidence: { arkanalyzer: { methodKey: input.callbackRegisterKey } },
            confidence: "certain",
            provenance: { source: "manual", location: { file: input.logicalFile } },
        });
        bindings.push({
            bindingId: `${input.id}.hdweb.onload.binding`,
            surfaceId: callbackSurfaceId,
            canonicalApiId: callbackCanonicalApiId,
            assetId: input.id,
            plane: "arkmain",
            role: "entry",
            effectTemplateRefs: [`${input.id}.hdweb.onload.effect`],
            semanticsFamily: "project_component_option_slot",
            completeness: "complete",
            confidence: "certain",
        });
        effectTemplates.push({
            id: `${input.id}.hdweb.onload.effect`,
            kind: "entry.callbackRegister",
            callback: input.callbackLocator || {
                kind: "option",
                base: { base: { kind: "arg", index: 0 } },
                accessPath: ["onLoad"],
            },
            callbackRole: "project_component_option_slot",
            confidence: "certain",
        });
    }
    return {
        id: input.id,
        plane: "arkmain",
        status: "reviewed",
        surfaces,
        bindings,
        effectTemplates,
        provenance: {
            source: "manual",
            projectId: "c2_gate",
            reviewedBy: "c2-test",
        },
    };
}

function writeProjectAsset(root: string, projectId: string, asset: unknown): void {
    writeJson(path.join(root, "project", projectId, "arkmain", "semanticflow.arkmain.json"), asset);
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/c2_arkmain_semantic_gate/latest");
    const sourceDir = path.join(root, "source");
    const logicalFile = "entry/src/main/ets/pages/LibraryPanel.ets";
    const sourceFile = path.join(sourceDir, logicalFile);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, `
function HdWeb(options: any): void {
  let hdwebMarker = "project-component";
}

@Component
struct LibraryPanel {
  onLoaded(): void {
    let callbackMarker = "callback-loaded";
  }

  build(): void {
    let marker = "project-component-build";
    HdWeb({ onLoad: this.onLoaded });
  }
}
`, "utf8");

    const scene = buildScene(sourceDir);
    const buildMethod = findMethod(scene, "build", "LibraryPanel");
    const buildKey = methodKeyFromMethod(buildMethod);
    const hdWebKey = findInvokeMethodKey(buildMethod, "HdWeb");

    const validRoot = path.join(root, "valid_assets");
    writeProjectAsset(validRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.valid",
        logicalFile,
        lifecycleKey: buildKey,
        callbackRegisterKey: hdWebKey,
    }));
    const validLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [validRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(validLoad.warnings.length === 0, `valid asset should not warn: ${validLoad.warnings.join("; ")}`);
    const lifecycleFact = validLoad.facts.find(fact =>
        fact.kind === "page_build"
        && fact.phase === "composition"
        && fact.method.getName?.() === "build"
    );
    assert(lifecycleFact, "exact lifecycle invoke surface should produce a page_build fact");
    assert(lifecycleFact.semanticGate === "exact_arkanalyzer_method_key", "lifecycle fact must record exact semantic gate");
    assert(lifecycleFact.canonicalApiId?.startsWith("api:project:local:"), "lifecycle fact must carry canonicalApiId");
    const callbackFact = validLoad.facts.find(fact =>
        fact.kind === "callback"
        && fact.method.getName?.() === "onLoaded"
        && fact.sourceMethod?.getName?.() === "build"
    );
    assert(callbackFact, "exact callbackRegister surface should produce callback fact");
    assert(callbackFact.semanticGate === "exact_arkanalyzer_method_key", "callback fact must record exact semantic gate");
    assert(callbackFact.canonicalApiId?.startsWith("api:project:local:"), "callback fact must carry canonicalApiId");
    assert(validLoad.endpointProjectionLedger.length === 1, "valid callback endpoint should write one arkmain endpoint projection ledger row");
    assert(validLoad.endpointProjectionLedger[0].consumer === "arkmain", "valid callback endpoint ledger should identify arkmain consumer");
    assert(validLoad.endpointProjectionLedger[0].consumerStatus === "consumable", "resolved callback endpoint should be consumable");
    assert(validLoad.endpointProjectionLedger[0].status === "resolved", "valid callback endpoint should resolve through common projector");
    assert(validLoad.endpointProjectionLedger[0].endpointPath === "arg0", `valid callback owner endpoint should be arg0, got ${validLoad.endpointProjectionLedger[0].endpointPath}`);

    const noRuntimeRoot = path.join(root, "no_runtime_endpoint_assets");
    writeProjectAsset(noRuntimeRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.no_runtime_callback_arg",
        logicalFile,
        lifecycleKey: buildKey,
        callbackRegisterKey: hdWebKey,
        callbackLocator: {
            kind: "option",
            base: {
                base: {
                    kind: "callbackArg",
                    callback: { kind: "arg", index: 0 },
                    argIndex: 0,
                },
            },
            accessPath: ["onLoad"],
        },
    }));
    const noRuntimeLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [noRuntimeRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(
        !noRuntimeLoad.facts.some(fact => fact.kind === "callback"),
        "no_runtime endpoint must block arkmain callback emission",
    );
    assert(noRuntimeLoad.endpointProjectionLedger.length === 1, "no_runtime callback endpoint should write one ledger row");
    assert(noRuntimeLoad.endpointProjectionLedger[0].status === "no_runtime_endpoint", "callbackArg without runtime binding should be no_runtime_endpoint");
    assert(noRuntimeLoad.endpointProjectionLedger[0].consumerStatus === "blocked", "no_runtime endpoint must be blocked");
    assert(noRuntimeLoad.endpointProjectionLedger[0].reason === "callback_binding_missing", `unexpected no_runtime reason ${noRuntimeLoad.endpointProjectionLedger[0].reason}`);
    assert(
        noRuntimeLoad.warnings.some(warning => warning.includes("blocked callback endpoint") && warning.includes("no_runtime_endpoint:callback_binding_missing")),
        `no_runtime endpoint should be diagnosed: ${noRuntimeLoad.warnings.join("; ")}`,
    );

    const missingAccessPathRoot = path.join(root, "missing_access_path_assets");
    writeProjectAsset(missingAccessPathRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.missing_access_path",
        logicalFile,
        lifecycleKey: buildKey,
        callbackRegisterKey: hdWebKey,
        callbackLocator: {
            kind: "option",
            base: {
                base: { kind: "arg", index: 0 },
                accessPath: ["missing"],
            },
            accessPath: ["onLoad"],
        },
    }));
    const missingAccessPathLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [missingAccessPathRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(
        !missingAccessPathLoad.facts.some(fact => fact.kind === "callback"),
        "unresolved object accessPath endpoint must block arkmain callback emission",
    );
    assert(missingAccessPathLoad.endpointProjectionLedger.length === 1, "unresolved object accessPath endpoint should write one ledger row");
    assert(missingAccessPathLoad.endpointProjectionLedger[0].status === "unsupported_exact_shape", "missing option field should be unsupported exact shape");
    assert(missingAccessPathLoad.endpointProjectionLedger[0].consumerStatus === "blocked", "unsupported accessPath endpoint must be blocked");
    assert(
        missingAccessPathLoad.endpointProjectionLedger[0].reason.includes("access_path_unresolved:missing"),
        `missing accessPath reason should be exact: ${missingAccessPathLoad.endpointProjectionLedger[0].reason}`,
    );
    assert(
        missingAccessPathLoad.warnings.some(warning => warning.includes("blocked callback endpoint") && warning.includes("unsupported_exact_shape")),
        `unsupported accessPath endpoint should be diagnosed: ${missingAccessPathLoad.warnings.join("; ")}`,
    );

    const invalidEndpointRoot = path.join(root, "invalid_endpoint_assets");
    writeProjectAsset(invalidEndpointRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.invalid_endpoint",
        logicalFile,
        lifecycleKey: buildKey,
        callbackRegisterKey: hdWebKey,
        callbackLocator: {
            kind: "option",
            base: { base: { kind: "arg", index: -1 } },
            accessPath: ["onLoad"],
        },
    }));
    const invalidEndpointLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [invalidEndpointRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(invalidEndpointLoad.facts.length === 0, "schema-gated asset endpoint error must not emit arkmain facts");
    assert(invalidEndpointLoad.endpointProjectionLedger.length === 0, "schema-gated endpoint error must not enter runtime projection ledger");
    assert(
        invalidEndpointLoad.warnings.some(warning => warning.includes("invalid arkmain asset file") && warning.includes("base.index must be a non-negative integer")),
        `invalid endpoint should be schema-gated: ${invalidEndpointLoad.warnings.join("; ")}`,
    );

    const missingKeyRoot = path.join(root, "missing_key_assets");
    writeProjectAsset(missingKeyRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.missing_key",
        logicalFile,
        lifecycleKey: buildKey,
        omitLifecycleEvidence: true,
    }));
    const missingKeyLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [missingKeyRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(missingKeyLoad.facts.length === 0, "surface without methodKey evidence must not activate arkmain facts");
    assert(
        missingKeyLoad.warnings.some(warning => warning.includes("missing exact Arkanalyzer methodKey evidence")),
        `missing methodKey should be diagnosed: ${missingKeyLoad.warnings.join("; ")}`,
    );

    const unsupportedRoot = path.join(root, "unsupported_assets");
    writeProjectAsset(unsupportedRoot, "c2_gate", makeArkMainAsset({
        id: "project.c2_gate.arkmain.unsupported",
        logicalFile,
        lifecycleKey: buildKey,
        lifecycleEntryKind: "arkmain-entry",
    }));
    const unsupportedLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [unsupportedRoot],
        enabledArkMainProjects: ["c2_gate"],
    });
    assert(unsupportedLoad.facts.length === 0, "unsupported lifecycle semantics must not fall back to page_build");
    assert(
        unsupportedLoad.warnings.some(warning => warning.includes("unsupported lifecycle semantics")),
        `unsupported lifecycle semantics should be diagnosed: ${unsupportedLoad.warnings.join("; ")}`,
    );

    console.log("PASS test_c2_arkmain_semantic_gate");
}

main().catch(error => {
    console.error("FAIL test_c2_arkmain_semantic_gate");
    console.error(error);
    process.exit(1);
});
