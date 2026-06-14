import * as fs from "fs";
import * as path from "path";
import {
    bootstrapAssetSurfaceRegistry,
    type AssetDocumentBase,
} from "../../core/assets/schema";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import { loadModules } from "../../core/orchestration/modules/ModuleLoader";
import { publishSemanticFlowProjectAssets } from "../../core/semanticflow/SemanticFlowProjectAssets";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import {
    assert,
    expectThrows,
    makeHandoffAsset,
    makeRuleAsset,
} from "./SemanticFlowV2TestHelpers";

function schemaValid(asset: AssetDocumentBase): AssetDocumentBase {
    return {
        ...asset,
        status: "schema-valid",
    };
}

function writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_evaluation_overlay_policy/latest");
    const modelRoot = path.join(root, "model_root");
    fs.rmSync(root, { recursive: true, force: true });

    const schemaValidRule = schemaValid(makeRuleAsset("asset.semanticflow.overlay.rule"));
    const schemaValidModule = schemaValid(makeHandoffAsset("asset.semanticflow.overlay.module"));
    const llmGeneratedRule = makeRuleAsset("asset.semanticflow.overlay.llm-generated-rule");

    const defaultRuleLowering = lowerRuleAssetsToRuleSet([schemaValidRule]);
    assert(defaultRuleLowering.ruleSet.sinks.length === 0, "schema-valid rule must not lower in trusted-analysis mode");
    const evalRuleLowering = lowerRuleAssetsToRuleSet([schemaValidRule], { loadMode: "semanticflow-evaluation" });
    assert(evalRuleLowering.ruleSet.sinks.length === 1, "schema-valid rule should lower under semanticflow evaluation mode");
    const llmRuleLowering = lowerRuleAssetsToRuleSet([llmGeneratedRule], { loadMode: "semanticflow-evaluation" });
    assert(llmRuleLowering.ruleSet.sinks.length === 0, "llm-generated rule must not lower even under semanticflow evaluation mode");

    expectThrows(
        () => lowerModuleAssetToInternalModuleLoweringIR(schemaValidModule),
        "not loadable",
    );
    const evalModule = lowerModuleAssetToInternalModuleLoweringIR(schemaValidModule, {
        loadMode: "semanticflow-evaluation",
    });
    assert(evalModule.semantics.length === 1, "schema-valid module should lower under semanticflow evaluation mode");

    const registry = bootstrapAssetSurfaceRegistry([schemaValidRule, schemaValidModule], { failOnInvalid: false });
    assert(registry.trustedAssetIds.length === 0, "schema-valid semanticflow assets must not enter known-covered registry");
    assert(registry.skippedAssets.length === 2, "schema-valid semanticflow assets should be skipped by trusted registry");

    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot,
        assets: [makeRuleAsset("asset.semanticflow.overlay.project-rule"), makeHandoffAsset("asset.semanticflow.overlay.project-module")],
    });

    const rulePath = path.join(modelRoot, "project", "semanticflow", "rules", "semanticflow.rules.json");
    const modulePath = path.join(modelRoot, "project", "semanticflow", "modules", "semanticflow.modules.json");
    assert(fs.existsSync(rulePath), "published semanticflow rule asset missing");
    assert(fs.existsSync(modulePath), "published semanticflow module asset missing");

    const trustedOnlyRules = loadRuleSet({
        kernelRulePath: "tests/rules/minimal.rules.json",
        projectRulePath: rulePath,
        autoDiscoverLayers: false,
    });
    assert(trustedOnlyRules.ruleSet.sinks.length === 0, "project schema-valid rule must stay inert without evaluation root");

    const overlayRules = loadRuleSet({
        kernelRulePath: "tests/rules/minimal.rules.json",
        projectRulePath: rulePath,
        autoDiscoverLayers: false,
        semanticflowEvaluationModelRoots: [modelRoot],
    });
    assert(overlayRules.ruleSet.sinks.length === 1, "project schema-valid rule should load only from evaluation root");
    const overlayProjectLayer = overlayRules.layerStatus.find(status => status.path === rulePath);
    assert(overlayProjectLayer?.applied === true, "semanticflow evaluation project rule layer should be marked applied");
    assert(overlayProjectLayer.sinkRuleCount === 1, "semanticflow evaluation project rule layer should expose lowered sink count");
    assert(overlayProjectLayer.sourceRuleCount === 0, "semanticflow evaluation project rule layer should expose lowered source count");
    assert(
        (overlayProjectLayer.sinkRuleIds || []).some(id =>
            id.startsWith("asset.semanticflow.overlay.project-rule.binding:")
            && id.endsWith("asset.semanticflow.overlay.project-rule.effect")
        ),
        "semanticflow evaluation project rule layer should expose lowered sink rule id",
    );

    const trustedOnlyModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [modelRoot],
        enabledModuleProjects: ["semanticflow"],
    });
    assert(trustedOnlyModules.modules.length === 0, "project schema-valid module must stay inert without evaluation root");

    const overlayModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [modelRoot],
        enabledModuleProjects: ["semanticflow"],
        semanticflowEvaluationModelRoots: [modelRoot],
    });
    assert(overlayModules.modules.length === 1, "project schema-valid module should load only from evaluation root");

    const firstEvaluationOnlyRoot = path.join(root, "first_evaluation_only_model_root");
    const secondEvaluationOnlyRoot = path.join(root, "second_evaluation_only_model_root");
    const firstEvaluationOnlyModule = makeHandoffAsset("asset.semanticflow.evaluation.root.first");
    const secondEvaluationOnlyModule = makeHandoffAsset("asset.semanticflow.evaluation.root.second");
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: firstEvaluationOnlyRoot,
        assets: [firstEvaluationOnlyModule],
    });
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: secondEvaluationOnlyRoot,
        assets: [secondEvaluationOnlyModule],
    });
    const multiEvaluationOnlyModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [],
        enabledModuleProjects: ["semanticflow"],
        semanticflowEvaluationModelRoots: [firstEvaluationOnlyRoot, secondEvaluationOnlyRoot],
    });
    const multiEvaluationOnlyModuleIds = new Set(multiEvaluationOnlyModules.modules.map(module => module.id));
    assert(
        multiEvaluationOnlyModuleIds.has(firstEvaluationOnlyModule.id)
        && multiEvaluationOnlyModuleIds.has(secondEvaluationOnlyModule.id),
        `semanticflow evaluation roots should be discovered and composed without requiring duplicate --model-root flags; loaded=${[...multiEvaluationOnlyModuleIds].join(",")}`,
    );
    assert(
        multiEvaluationOnlyModules.loadIssues.length === 0,
        `multi-root evaluation overlay should not leave load issues: ${JSON.stringify(multiEvaluationOnlyModules.loadIssues)}`,
    );

    const outsideRoot = path.join(root, "outside_model_root");
    const outsideRulePath = path.join(outsideRoot, "project", "semanticflow", "rules", "outside.rules.json");
    writeJson(outsideRulePath, schemaValidRule);
    const outsideRules = loadRuleSet({
        kernelRulePath: "tests/rules/minimal.rules.json",
        projectRulePath: outsideRulePath,
        autoDiscoverLayers: false,
        semanticflowEvaluationModelRoots: [modelRoot],
    });
    assert(outsideRules.ruleSet.sinks.length === 0, "evaluation mode must be restricted to declared model roots");

    const duplicateRoot = path.join(root, "duplicate_surface_model_root");
    const firstRole = makeRuleAsset("asset.semanticflow.duplicate.first");
    firstRole.surfaces[0].surfaceId = "surface.Duplicate.shared";
    firstRole.bindings[0].surfaceId = "surface.Duplicate.shared";
    const secondRole = makeRuleAsset("asset.semanticflow.duplicate.second");
    secondRole.surfaces[0] = { ...firstRole.surfaces[0] };
    secondRole.bindings[0].surfaceId = "surface.Duplicate.shared";
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: duplicateRoot,
        assets: [firstRole, secondRole],
    });
    const duplicateRulePath = path.join(duplicateRoot, "project", "semanticflow", "rules", "semanticflow.rules.json");
    const duplicateRuleAsset = JSON.parse(fs.readFileSync(duplicateRulePath, "utf8")) as AssetDocumentBase;
    assert(duplicateRuleAsset.surfaces.length === 1, "aggregate should keep one shared surface for multiple bindings");
    assert(duplicateRuleAsset.bindings.length === 2, "aggregate should preserve distinct bindings on the shared surface");

    const equivalentRoot = path.join(root, "equivalent_binding_model_root");
    const firstEquivalent = makeRuleAsset("asset.semanticflow.equivalent.first", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.PromiseApi.returnedValue",
        effectId: "template.PromiseApi.promiseResult.source",
    });
    const secondEquivalent = makeRuleAsset("asset.semanticflow.equivalent.second", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.PromiseApi.promiseResult.source",
        effectId: "template.PromiseApi.promiseResult.source",
    });
    secondEquivalent.surfaces[0] = { ...firstEquivalent.surfaces[0] };
    secondEquivalent.bindings[0].surfaceId = firstEquivalent.bindings[0].surfaceId;
    secondEquivalent.effectTemplates[0] = { ...firstEquivalent.effectTemplates[0] };
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: equivalentRoot,
        assets: [firstEquivalent, secondEquivalent],
    });
    const equivalentRulePath = path.join(equivalentRoot, "project", "semanticflow", "rules", "semanticflow.rules.json");
    const equivalentRuleAsset = JSON.parse(fs.readFileSync(equivalentRulePath, "utf8")) as AssetDocumentBase;
    assert(equivalentRuleAsset.surfaces.length === 1, "equivalent binding aggregate should keep one shared surface");
    assert(equivalentRuleAsset.effectTemplates.length === 1, "equivalent binding aggregate should keep one shared template");
    assert(equivalentRuleAsset.bindings.length === 1, "aggregate should merge equivalent bindings that differ only by local ids");
    assert(!!equivalentRuleAsset.bindings[0].assetId, "merged equivalent binding must retain assetId");

    const equivalentModuleRoot = path.join(root, "equivalent_module_binding_model_root");
    const firstModuleEquivalent = makeHandoffAsset("asset.semanticflow.equivalent.module.first");
    const secondModuleEquivalent: AssetDocumentBase = JSON.parse(JSON.stringify(firstModuleEquivalent));
    secondModuleEquivalent.id = "asset.semanticflow.equivalent.module.second";
    secondModuleEquivalent.bindings[0].assetId = secondModuleEquivalent.id;
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: equivalentModuleRoot,
        assets: [firstModuleEquivalent, secondModuleEquivalent],
    });
    const equivalentModulePath = path.join(equivalentModuleRoot, "project", "semanticflow", "modules", "semanticflow.modules.json");
    const equivalentModuleAsset = JSON.parse(fs.readFileSync(equivalentModulePath, "utf8")) as AssetDocumentBase;
    assert(equivalentModuleAsset.surfaces.length === 1, "equivalent module aggregate should keep one shared surface");
    assert(equivalentModuleAsset.effectTemplates?.length === 1, "equivalent module aggregate should keep one shared template");
    assert(equivalentModuleAsset.bindings.length === 1, "equivalent module bindings that differ only by source assetId should merge");
    assert(!!equivalentModuleAsset.bindings[0].assetId, "merged equivalent module binding must retain assetId");

    const pairedFamilyRoot = path.join(root, "paired_family_normalization_model_root");
    const pairedFamilyAsset = makeHandoffAsset("asset.semanticflow.paired.family");
    pairedFamilyAsset.surfaces.push({
        ...(pairedFamilyAsset.surfaces[0] as any),
        surfaceId: "asset.semanticflow.paired.family.load.surface",
        methodName: "load",
        argCount: 1,
    });
    pairedFamilyAsset.bindings.push({
        ...(pairedFamilyAsset.bindings[0] as any),
        bindingId: "asset.semanticflow.paired.family.load.binding",
        surfaceId: "asset.semanticflow.paired.family.load.surface",
        endpoint: { base: { kind: "return" } },
        effectTemplateRefs: ["asset.semanticflow.paired.family.load.get"],
    });
    pairedFamilyAsset.effectTemplates!.push({
        id: "asset.semanticflow.paired.family.load.get",
        kind: "handoff.get",
        handle: {
            cellKind: "keyed-semantic-slot",
            family: "project.TokenCache",
            key: [{ kind: "fromLiteralArg", index: 0 }],
            precision: "infer",
        },
        target: { base: { kind: "return" } },
        confidence: "likely",
    } as any);
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: pairedFamilyRoot,
        assets: [pairedFamilyAsset],
    });
    const pairedFamilyPath = path.join(pairedFamilyRoot, "project", "semanticflow", "modules", "semanticflow.modules.json");
    const pairedFamilyPublished = JSON.parse(fs.readFileSync(pairedFamilyPath, "utf8")) as AssetDocumentBase;
    const pairedFamilies = new Set((pairedFamilyPublished.effectTemplates || []).map(template => (template as any).handle?.family).filter(Boolean));
    assert(pairedFamilies.size === 1, `paired same-layout handoff templates should publish with one canonical family, got ${[...pairedFamilies].join(",")}`);
    const pairedFamilyModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [pairedFamilyRoot],
        enabledModuleProjects: ["semanticflow"],
        semanticflowEvaluationModelRoots: [pairedFamilyRoot],
    });
    assert(pairedFamilyModules.modules.length === 1, "paired family normalization should make published module loadable");
    assert(pairedFamilyModules.loadIssues.length === 0, `paired family normalization should not leave load issues: ${JSON.stringify(pairedFamilyModules.loadIssues)}`);

    const divergentFamilyRoot = path.join(root, "divergent_family_layout_model_root");
    const divergentFamilyAsset = makeHandoffAsset("asset.semanticflow.divergent.family");
    divergentFamilyAsset.effectTemplates![0] = {
        ...(divergentFamilyAsset.effectTemplates![0] as any),
        handle: {
            ...(divergentFamilyAsset.effectTemplates![0] as any).handle,
            family: "project.first_store",
            key: [{ kind: "const", value: "first" }],
        },
    } as any;
    divergentFamilyAsset.surfaces.push({
        ...(divergentFamilyAsset.surfaces[0] as any),
        surfaceId: "asset.semanticflow.divergent.family.load.surface",
        methodName: "loadSecond",
        argCount: 0,
    });
    divergentFamilyAsset.bindings.push({
        ...(divergentFamilyAsset.bindings[0] as any),
        bindingId: "asset.semanticflow.divergent.family.load.binding",
        surfaceId: "asset.semanticflow.divergent.family.load.surface",
        endpoint: { base: { kind: "return" } },
        effectTemplateRefs: ["asset.semanticflow.divergent.family.load.get"],
    });
    divergentFamilyAsset.effectTemplates!.push({
        id: "asset.semanticflow.divergent.family.load.get",
        kind: "handoff.get",
        handle: {
            cellKind: "keyed-semantic-slot",
            family: "project.second_store",
            key: [{ kind: "const", value: "second" }],
            precision: "infer",
        },
        target: { base: { kind: "return" } },
        confidence: "likely",
    } as any);
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: divergentFamilyRoot,
        assets: [divergentFamilyAsset],
    });
    const divergentFamilyPath = path.join(divergentFamilyRoot, "project", "semanticflow", "modules", "semanticflow.modules.json");
    const divergentFamilyPublished = JSON.parse(fs.readFileSync(divergentFamilyPath, "utf8")) as AssetDocumentBase;
    const divergentFamilies = new Set((divergentFamilyPublished.effectTemplates || []).map(template => (template as any).handle?.family).filter(Boolean));
    assert(
        divergentFamilies.has("project.first_store") && divergentFamilies.has("project.second_store"),
        "different handle layouts must retain distinct families",
    );

    const divergentRoot = path.join(root, "divergent_surface_model_root");
    const divergentRequest = makeRuleAsset("asset.semanticflow.duplicate.request");
    divergentRequest.surfaces[0].surfaceId = "surface.Duplicate.shared";
    (divergentRequest.surfaces[0] as any).argCount = 3;
    divergentRequest.bindings[0].surfaceId = "surface.Duplicate.shared";
    const divergentResponse = makeRuleAsset("asset.semanticflow.duplicate.response", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.Duplicate.promiseResult.source",
        effectId: "template.Duplicate.promiseResult.source",
    });
    divergentResponse.surfaces[0].surfaceId = "surface.Duplicate.shared";
    (divergentResponse.surfaces[0] as any).argCount = 2;
    divergentResponse.bindings[0].surfaceId = "surface.Duplicate.shared";
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: divergentRoot,
        assets: [divergentRequest, divergentResponse],
    });
    const divergentRulePath = path.join(divergentRoot, "project", "semanticflow", "rules", "semanticflow.rules.json");
    const divergentRuleAsset = JSON.parse(fs.readFileSync(divergentRulePath, "utf8")) as AssetDocumentBase;
    assert(divergentRuleAsset.surfaces.length === 2, "aggregate should preserve same local surfaceId with divergent shapes");
    assert(
        new Set(divergentRuleAsset.surfaces.map(surface => surface.surfaceId)).size === 2,
        "divergent generated surfaces must be disambiguated with distinct surface ids",
    );
    const requestSurface = divergentRuleAsset.surfaces.find(surface => (surface as any).argCount === 3);
    const responseSurface = divergentRuleAsset.surfaces.find(surface => (surface as any).argCount === 2);
    assert(!!requestSurface && !!responseSurface, "disambiguated surfaces must retain their analyzer-backed shapes");
    assert(
        divergentRuleAsset.bindings.some(binding => binding.role === "sink" && binding.surfaceId === requestSurface.surfaceId),
        "request binding should stay attached to the request-shaped surface",
    );
    assert(
        divergentRuleAsset.bindings.some(binding => binding.role === "source" && binding.surfaceId === responseSurface.surfaceId),
        "response binding should be rewritten to the response-shaped surface",
    );

    const divergentLocalIdRoot = path.join(root, "divergent_local_id_model_root");
    const localSource = makeRuleAsset("asset.semanticflow.local-id.source", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.ProjectApi.shared",
        effectId: "template.ProjectApi.shared",
    });
    const localSink = makeRuleAsset("asset.semanticflow.local-id.sink", {
        role: "sink",
        effectKind: "rule.sink",
        bindingId: "binding.ProjectApi.shared",
        effectId: "template.ProjectApi.shared",
    });
    localSink.surfaces[0] = { ...localSource.surfaces[0] };
    localSink.bindings[0].surfaceId = localSource.bindings[0].surfaceId;
    publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: divergentLocalIdRoot,
        assets: [localSource, localSink],
    });
    const divergentLocalIdPath = path.join(divergentLocalIdRoot, "project", "semanticflow", "rules", "semanticflow.rules.json");
    const divergentLocalIdAsset = JSON.parse(fs.readFileSync(divergentLocalIdPath, "utf8")) as AssetDocumentBase;
    assert(divergentLocalIdAsset.surfaces.length === 1, "same surface shape should still be shared");
    assert(divergentLocalIdAsset.bindings.length === 2, "divergent local binding ids should be disambiguated, not dropped");
    assert(divergentLocalIdAsset.effectTemplates?.length === 2, "divergent local template ids should be disambiguated, not dropped");
    assert(
        new Set(divergentLocalIdAsset.bindings.map(binding => binding.bindingId)).size === 2,
        "published bindings must have unique ids after local-id disambiguation",
    );
    assert(
        new Set((divergentLocalIdAsset.effectTemplates || []).map(template => template.id)).size === 2,
        "published templates must have unique ids after local-id disambiguation",
    );
    const publishedTemplateIds = new Set((divergentLocalIdAsset.effectTemplates || []).map(template => template.id));
    for (const binding of divergentLocalIdAsset.bindings) {
        for (const ref of binding.effectTemplateRefs || []) {
            assert(publishedTemplateIds.has(ref), `binding ${binding.bindingId} references missing template ${ref}`);
        }
    }
    assert(
        divergentLocalIdAsset.bindings.some(binding => binding.role === "source") &&
        divergentLocalIdAsset.bindings.some(binding => binding.role === "sink"),
        "local-id disambiguation must preserve both source and sink semantics",
    );

    console.log("PASS test_semanticflow_evaluation_overlay_policy");
}

main();
