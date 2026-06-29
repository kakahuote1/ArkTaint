import * as fs from "fs";
import * as path from "path";
import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import type {
    AssetBinding,
    AssetDocumentBase,
    AssetEndpoint,
    EndpointSelectorRef,
    RuleTransferTemplate,
    RuleValueRef,
} from "../../core/assets/schema";
import type {
    RuleEndpoint,
    RuleEndpointOrRef,
    RuleEndpointRef,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../../core/rules/RuleSchema";
import {
    exactRuleRuntimeFromAssets,
    exactSinkRule,
    exactSourceRule,
    exactTransferRule,
    type ExactRuleFixture,
    type ExactRuleRuntime,
} from "../rules/ExactRuleTestUtils";
import { assertCanonicalExactRules, type TransferTestFixture } from "./ExactTransferTestUtils";

export interface ExactTransferScenario {
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    transferRules: TransferRule[];
    exactRuntime: ExactRuleRuntime;
    exactRuntimeWithoutExtraTransferAssets: ExactRuleRuntime;
    droppedTransferRules?: Array<{ id: string; reason: string }>;
}

type RuleFixture = TransferTestFixture;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

export function buildExactTransferScenario(input: {
    scene: Scene;
    scenarioId: string;
    caseNames: string[];
}): ExactTransferScenario {
    const sourceFixtures = input.caseNames.map(caseName => exactSourceRule({
        id: `source.${input.scenarioId}.entry.${caseName}`,
        method: findMethod(input.scene, caseName),
        target: "arg0",
        sourceKind: "entry_param",
    }));
    const sinkFixture = exactSinkRule({
        id: `sink.${input.scenarioId}.arg0`,
        method: findMethod(input.scene, "Sink"),
        target: "arg0",
    });

    const extraAssets: AssetDocumentBase[] = [];
    const transferFixtures = transferFixturesForScenario(input.scene, input.scenarioId, extraAssets);
    const sourceRules = sourceFixtures.map(fixture => fixture.rule);
    const sinkRules = [sinkFixture.rule];
    const transferRules = [
        ...transferFixtures.map(fixture => fixture.rule),
        ...lowerExtraTransferAssets(extraAssets),
    ];
    assertCanonicalExactRules([...sourceRules, ...sinkRules, ...transferRules]);
    const fixtures: RuleFixture[] = [sinkFixture, ...sourceFixtures, ...transferFixtures];
    const fixtureAssets = fixtures.map(fixture => fixture.asset);
    const fixtureDescriptors = fixtures.map(fixture => fixture.exact.canonicalApiDescriptor);
    const exactRuntime = exactRuleRuntimeFromAssets(
        [
            ...extraAssets,
            ...fixtureAssets,
        ],
        fixtureDescriptors,
    );
    const exactRuntimeWithoutExtraTransferAssets = exactRuleRuntimeFromAssets(fixtureAssets, fixtureDescriptors);
    return {
        sourceRules,
        sinkRules,
        transferRules,
        exactRuntime,
        exactRuntimeWithoutExtraTransferAssets,
        droppedTransferRules: [],
    };
}

function transferFixturesForScenario(scene: Scene, scenarioId: string, extraAssets: AssetDocumentBase[]): Array<ExactRuleFixture<TransferRule>> {
    switch (scenarioId) {
        case "rule_transfer":
            return [
                transfer(scene, "transfer.rule.box001.putData.arg0_to_base", "putData", "arg0", "base", { className: "Box001" }),
                transfer(scene, "transfer.rule.box001.get.base_to_result", "get", "base", "result", { className: "Box001" }),
                transfer(scene, "transfer.rule.dict002.putPair.arg1_to_base", "putPair", "arg1", "base", { className: "Dict002" }),
                transfer(scene, "transfer.rule.dict002.get.base_to_result", "get", "base", "result", { className: "Dict002" }),
                transfer(scene, "transfer.rule.mirror003.bind.arg0_to_base", "bind", "arg0", "base", { className: "Mirror003" }),
                transfer(scene, "transfer.rule.mirror003.paint.base_to_arg0", "paint", "base", "arg0", { className: "Mirror003" }),
                transfer(scene, "transfer.rule.mixer004.blend.arg1_to_result", "blend", "arg1", "result", { className: "Mixer004" }),
                transfer(scene, "transfer.rule.relay005.project.result_to_arg0", "project", "result", "arg0", { className: "Relay005" }),
                transfer(scene, "transfer.rule.box006.putData.arg0_to_base", "putData", "arg0", "base", { className: "Box006" }),
                transfer(scene, "transfer.rule.box006.get.base_to_result", "get", "base", "result", { className: "Box006" }),
                transfer(scene, "transfer.rule.mirror007.bind.arg0_to_base", "bind", "arg0", "base", { className: "Mirror007" }),
                transfer(scene, "transfer.rule.mirror007.paint.base_to_arg0", "paint", "base", "arg0", { className: "Mirror007" }),
            ];
        case "rule_transfer_variants":
            return [
                transfer(scene, "transfer.variants.vault101.stash.arg0_to_base", "stash", "arg0", "base", { className: "Vault101" }),
                transfer(scene, "transfer.variants.vault101.read.base_to_result", "read", "base", "result", { className: "Vault101" }),
                transfer(scene, "transfer.variants.vault106.stash.arg0_to_base", "stash", "arg0", "base", { className: "Vault106" }),
                transfer(scene, "transfer.variants.vault106.read.base_to_result", "read", "base", "result", { className: "Vault106" }),
                transfer(scene, "transfer.variants.mix102.merge.arg1_to_result", "merge", "arg1", "result", { className: "Mix102" }),
                transfer(scene, "transfer.variants.brush103.attach.arg0_to_base", "attach", "arg0", "base", { className: "Brush103" }),
                transfer(scene, "transfer.variants.brush103.emit.base_to_arg0", "emit", "base", "arg0", { className: "Brush103" }),
                transfer(scene, "transfer.variants.relay104.relay.result_to_arg0", "relay", "result", "arg0", { className: "Relay104" }),
            ];
        case "rule_precision_transfer":
            extraAssets.push(loadCollectionTransferAsset());
            return [
                transfer(scene, "transfer.precision.invoke_kind.instance_arg0_to_result", "BridgeInvokeKind", "arg0", "result", { className: "InvokeKindHost" }),
                transfer(scene, "transfer.precision.arg_count.arg1_to_result", "BridgeArgCount", "arg1", "result", { signatureIncludes: "taint.%dflt.BridgeArgCount" }),
                transfer(scene, "transfer.precision.type_hint.target_arg0_to_result", "BridgeTypeHint", "arg0", "result", { className: "TransferTypeHostTarget" }),
                transfer(scene, "transfer.precision.scope.allowed_arg0_to_result", "BridgeScope", "arg0", "result", { className: "ScopeHostAllowed" }),
                transfer(scene, "transfer.precision.compose.pipe.arg0_to_base", "Pipe", "arg0", "base", { className: "ComposeBox" }),
                transfer(scene, "transfer.precision.compose.pipe.base_to_result", "Pipe", "base", "result", { className: "ComposeBox" }),
            ];
        case "transfer_overload_conflicts":
            return [
                transfer(scene, "transfer.overload.instance.allowed.arg0_to_result", "BridgeSame", "arg0", "result", { className: "ConflictAllowed" }),
                transfer(scene, "transfer.overload.static.allowed.arg0_to_result", "BridgeSame", "arg0", "result", { className: "ConflictStaticAllowed" }),
                transfer(scene, "transfer.overload.arity.arg1_to_result", "BridgeArity", "arg1", "result", { className: "ConflictArity" }),
            ];
        case "transfer_priority":
            return [
                transfer(scene, "transfer.priority.exact.class_exact.arg0_to_result", "Bridge", "arg0", "result", { className: "PriorityHostExact" }),
                transfer(scene, "transfer.priority.constrained.scope.arg0_to_result", "Bridge", "arg0", "result", { className: "PriorityHostConstrained" }),
                transfer(scene, "transfer.priority.method_scoped.host.arg0_to_result", "Bridge", "arg0", "result", { className: "PriorityHostMethodScoped" }),
            ];
        default:
            throw new Error(`unsupported exact transfer scenario: ${scenarioId}`);
    }
}

function transfer(
    scene: Scene,
    id: string,
    methodName: string,
    from: TransferRule["from"],
    to: TransferRule["to"],
    options: { className?: string; signatureIncludes?: string } = {},
): ExactRuleFixture<TransferRule> {
    return exactTransferRule({
        id,
        method: findMethod(scene, methodName, options),
        from,
        to,
    });
}

function findMethod(
    scene: Scene,
    methodName: string,
    options: { className?: string; signatureIncludes?: string } = {},
): ArkMethod {
    const method = scene.getMethods().find(candidate => {
        if (candidate.getName?.() !== methodName) return false;
        const signature = String(candidate.getSignature?.().toString?.() || "");
        if (options.className && candidate.getDeclaringArkClass?.()?.getName?.() !== options.className) {
            return false;
        }
        if (options.signatureIncludes && !signature.includes(options.signatureIncludes)) {
            return false;
        }
        return true;
    });
    assert(method, `method not found: ${methodName}${options.className ? ` class=${options.className}` : ""}`);
    return method;
}

function loadCollectionTransferAsset(): AssetDocumentBase {
    const assetPath = path.resolve("src/models/kernel/rules/transfers/collection.rules.json");
    return JSON.parse(fs.readFileSync(assetPath, "utf-8")) as AssetDocumentBase;
}

function lowerExtraTransferAssets(extraAssets: AssetDocumentBase[]): TransferRule[] {
    if (extraAssets.length === 0) return [];
    return extraAssets.flatMap(asset => exactTransferRulesFromAsset(asset));
}

function exactTransferRulesFromAsset(asset: AssetDocumentBase): TransferRule[] {
    assert(asset.plane === "rule", `extra asset must be rule plane: ${asset.id}`);
    const templates = new Map((asset.effectTemplates || []).map(template => [template.id, template]));
    const rules: TransferRule[] = [];
    for (const binding of asset.bindings || []) {
        if (binding.plane !== "rule" || binding.role !== "transfer") continue;
        for (const templateRef of binding.effectTemplateRefs || []) {
            const template = templates.get(templateRef);
            assert(template, `${asset.id}:${binding.bindingId} references missing template ${templateRef}`);
            assert(template.kind === "rule.transfer", `${asset.id}:${binding.bindingId} references non-transfer template ${templateRef}`);
            rules.push(exactTransferRuleFromBinding(asset, binding, template));
        }
    }
    return rules;
}

function exactTransferRuleFromBinding(
    asset: AssetDocumentBase,
    binding: AssetBinding,
    template: RuleTransferTemplate,
): TransferRule {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === binding.surfaceId);
    assert(surface, `${asset.id}:${binding.bindingId} references missing surface ${binding.surfaceId}`);
    assert(binding.canonicalApiId, `${asset.id}:${binding.bindingId} must declare canonicalApiId`);
    assert(
        binding.canonicalApiId === surface.canonicalApiId,
        `${asset.id}:${binding.bindingId} canonicalApiId must exactly match surface ${binding.surfaceId}`,
    );
    assert(!binding.canonicalApiId.includes("%unk") && !binding.canonicalApiId.includes("@unk"), `${asset.id}:${binding.bindingId} has unknown canonicalApiId`);
    return {
        id: exactTransferRuleId(binding, template),
        enabled: binding.metadata?.enabled !== false,
        description: binding.metadata?.description,
        tags: binding.metadata?.tags,
        family: binding.metadata?.family || binding.semanticsFamily,
        match: {
            kind: "canonical_api_id_equals",
            value: binding.canonicalApiId,
        },
        category: binding.metadata?.category || binding.semanticsFamily,
        severity: binding.metadata?.severity,
        apiEffect: {
            canonicalApiId: binding.canonicalApiId,
            assetId: asset.id,
            surfaceId: binding.surfaceId,
            bindingId: binding.bindingId,
            effectTemplateId: template.id,
            role: "transfer",
        },
        from: lowerAssetRuleValueRef(template.from),
        to: lowerAssetRuleValueRef(template.to),
    };
}

function exactTransferRuleId(binding: AssetBinding, template: RuleTransferTemplate): string {
    if (template.id.startsWith("template.")) {
        return template.id.slice("template.".length);
    }
    if (binding.bindingId.startsWith("binding.")) {
        return binding.bindingId.replace(/^binding\./, "").replace(/\.\d+$/, "");
    }
    return `${binding.bindingId}:${template.id}`;
}

function lowerAssetRuleValueRef(ref: RuleValueRef): RuleEndpointOrRef {
    if (isAssetEndpointSelectorRef(ref)) {
        const endpoint = lowerAssetEndpoint(ref.endpoint);
        if (typeof endpoint !== "object" && !ref.pathFrom && !ref.slotKind && !ref.slotWriteMode && !ref.taintScope) {
            return endpoint;
        }
        const out: RuleEndpointRef = typeof endpoint === "object" ? { ...endpoint } : { endpoint };
        if (ref.pathFrom) {
            const from = lowerAssetEndpoint(ref.pathFrom);
            out.pathFrom = typeof from === "string" ? from : from.endpoint;
        }
        if (ref.slotKind) {
            out.slotKind = ref.slotKind;
        }
        if (ref.slotWriteMode) {
            out.slotWriteMode = ref.slotWriteMode;
        }
        if (ref.taintScope) {
            out.taintScope = ref.taintScope;
        }
        return out;
    }
    return lowerAssetEndpoint(ref);
}

function lowerAssetEndpoint(endpoint: AssetEndpoint): RuleEndpointOrRef {
    const base = endpoint.base;
    let lowered: RuleEndpoint;
    let semanticEndpointKind: RuleEndpointRef["semanticEndpointKind"];
    switch (base.kind) {
        case "receiver":
            lowered = "base";
            break;
        case "return":
            lowered = "result";
            break;
        case "promiseResult":
            semanticEndpointKind = "promiseResult";
            lowered = "result";
            break;
        case "promiseRejected":
            semanticEndpointKind = "promiseRejected";
            lowered = "result";
            break;
        case "constructorResult":
            semanticEndpointKind = "constructorResult";
            lowered = "result";
            break;
        case "arg":
            lowered = `arg${base.index}` as RuleEndpoint;
            break;
        case "callbackArg":
            lowered = `arg${base.argIndex}` as RuleEndpoint;
            break;
        case "callbackReturn":
            semanticEndpointKind = "callbackReturn";
            lowered = "result";
            break;
        default:
            lowered = "result";
    }
    if ((endpoint.accessPath && endpoint.accessPath.length > 0) || semanticEndpointKind || endpoint.taintScope) {
        return {
            endpoint: lowered,
            path: endpoint.accessPath && endpoint.accessPath.length > 0 ? [...endpoint.accessPath] : undefined,
            taintScope: endpoint.taintScope,
            semanticEndpointKind,
        };
    }
    return lowered;
}

function isAssetEndpointSelectorRef(ref: RuleValueRef): ref is EndpointSelectorRef {
    return typeof (ref as EndpointSelectorRef).endpoint === "object";
}
