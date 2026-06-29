import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import type { SourceRule } from "../../core/rules/RuleSchema";
import { CallEdgeType } from "../../core/kernel/context/TaintContext";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function methodSignature(scene: Scene, className: string, methodName: string): string {
    return findMethod(scene, className, methodName).getSignature().toString();
}

function findMethod(scene: Scene, className: string, methodName: string) {
    const method = scene.getMethods().find(candidate =>
        candidate.getName?.() === methodName
        && candidate.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `missing method ${className}.${methodName}`);
    return method;
}

function hasFact(plan: ReturnType<typeof buildArkMainPlan>, className: string, methodName: string): boolean {
    return Boolean(findFact(plan, className, methodName));
}

function findFact(plan: ReturnType<typeof buildArkMainPlan>, className: string, methodName: string) {
    return plan.facts.find(fact =>
        fact.method.getName?.() === methodName
        && fact.method.getDeclaringArkClass?.()?.getName?.() === className
    );
}

function assertReachable(reachable: Set<string>, signature: string): void {
    assert(reachable.has(signature), `reachable set missing ${signature}`);
}

function assertNotReachable(reachable: Set<string>, signature: string): void {
    assert(!reachable.has(signature), `reachable set unexpectedly contains ${signature}`);
}

function findRuleByAssetId(sourceRules: SourceRule[], assetId: string): SourceRule {
    const rule = sourceRules.find(item => item.apiEffect?.assetId === assetId);
    assert(rule, `missing lowered source rule for ${assetId}`);
    return rule;
}

function findSyntheticCarrierCallback(scene: Scene) {
    const method = scene.getMethods().find(candidate => {
        const name = candidate.getName?.() || "";
        const signature = candidate.getSignature?.()?.toString?.() || "";
        return name.includes("%AM")
            && signature.includes("DecoratedSourcePage.%AM")
            && signature.includes("$SearchPanel");
    });
    assert(method, "missing synthetic carrier callback method under DecoratedSourcePage.SearchPanel");
    return method;
}

function injectExactSyntheticReachabilityEdges(
    engine: TaintPropagationEngine,
    caller: any,
    callees: any[],
): void {
    const edgeMap = (engine as any).syntheticInvokeEdgeMap as Map<number, any[]>;
    assert(edgeMap instanceof Map, "engine synthetic invoke edge map should be initialized");
    const callerSignature = caller.getSignature?.()?.toString?.() || "";
    assert(callerSignature, "synthetic reachability caller must have signature");
    let slot = -700000;
    for (const callee of callees) {
        const calleeSignature = callee.getSignature?.()?.toString?.() || "";
        assert(calleeSignature, "synthetic reachability callee must have signature");
        const key = slot--;
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key)!.push({
            type: CallEdgeType.CALL,
            srcNodeId: key,
            dstNodeId: key - 1,
            callSiteId: Math.abs(key),
            callerMethodName: caller.getName?.() || "",
            calleeMethodName: callee.getName?.() || "",
            callerSignature,
            calleeSignature,
            originTag: "test.exact_synthetic_reachability",
        });
    }
}

async function main(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/demo/arkmain_decorator_component_reachability"));
    const lifecycleSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.lifecycle_source",
        role: "source",
        method: findMethod(scene, "LifecycleSource", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const builderSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.builder_source",
        role: "source",
        method: findMethod(scene, "BuilderSource", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const plainSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.plain_source",
        role: "source",
        method: findMethod(scene, "PlainSource", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const syntheticUtilitySource = projectApiEffectAssetFromMethod({
        id: "decorator_component.synthetic_utility_source",
        role: "source",
        method: findMethod(scene, "SyntheticDisplayApi", "readDisplay"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const syntheticCallbackSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.synthetic_callback_source",
        role: "source",
        method: findMethod(scene, "SyntheticCallbackEmitter", "once"),
        endpoint: {
            base: {
                kind: "callbackArg",
                callback: { kind: "arg", index: 0 },
                argIndex: 0,
            },
        },
        sourceKind: "callback_param",
    });
    const syntheticTaskSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.synthetic_task_source",
        role: "source",
        method: findMethod(scene, "SyntheticTaskApi", "request"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const unreachableSource = projectApiEffectAssetFromMethod({
        id: "decorator_component.unreachable_source",
        role: "source",
        method: findMethod(scene, "UnreachableApi", "read"),
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const apiAssets = [lifecycleSource.asset, builderSource.asset, plainSource.asset];
    apiAssets.push(
        syntheticUtilitySource.asset,
        syntheticCallbackSource.asset,
        syntheticTaskSource.asset,
        unreachableSource.asset,
    );
    const canonicalApiRegistry = createCanonicalApiRegistry([
        lifecycleSource.canonicalApiDescriptor,
        builderSource.canonicalApiDescriptor,
        plainSource.canonicalApiDescriptor,
        syntheticUtilitySource.canonicalApiDescriptor,
        syntheticCallbackSource.canonicalApiDescriptor,
        syntheticTaskSource.canonicalApiDescriptor,
        unreachableSource.canonicalApiDescriptor,
    ]);
    const lowered = lowerRuleAssetsToRuleSet(apiAssets);
    assert(lowered.diagnostics.length === 0, `unexpected rule lowering diagnostics: ${lowered.diagnostics.join("; ")}`);
    const sourceRules = lowered.ruleSet.sources;
    const validation = validateRuleSet({ sources: sourceRules, sinks: [], transfers: [] });
    assert(validation.valid, `rules invalid: ${validation.errors.join("; ")}`);

    const plan = buildArkMainPlan(scene);
    assert(
        hasFact(plan, "DecoratedSourcePage", "aboutToAppear"),
        "decorator-qualified component owner should produce aboutToAppear ArkMain fact",
    );
    assert(
        hasFact(plan, "DecoratedSourcePage", "build"),
        "decorator-qualified component owner should produce build ArkMain fact",
    );
    for (const [className, methodName] of [
        ["DecoratedSourcePage", "aboutToAppear"],
        ["DecoratedSourcePage", "build"],
    ] as const) {
        const fact = findFact(plan, className, methodName);
        assert(fact?.canonicalApiId, `${className}.${methodName} fact should carry official canonicalApiId`);
        assert(
            fact.semanticGate === "exact_decorator_qualified_owner_slot",
            `${className}.${methodName} fact should come from decorator-qualified owner slot, got ${fact?.semanticGate}`,
        );
        assert(
            fact.recognitionLayer === "qualified_decorator_first_layer",
            `${className}.${methodName} fact should carry Arkanalyzer decorator recognition layer`,
        );
    }
    assert(
        !hasFact(plan, "PlainPanel", "build"),
        "plain class build without decorator owner evidence must not produce ArkMain fact",
    );

    const engine = new TaintPropagationEngine(scene, 1, { apiAssets, canonicalApiRegistry });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const syntheticCarrierCallback = findSyntheticCarrierCallback(scene);
    injectExactSyntheticReachabilityEdges(engine, syntheticCarrierCallback, [
        findMethod(scene, "SyntheticDisplayUtility", "getScreenWidth"),
        findMethod(scene, "SyntheticCallbackRegistrationTask", "registerOnce"),
        findMethod(scene, "SyntheticFactoryTask", "doStart"),
    ]);
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    assertReachable(reachable, methodSignature(scene, "DecoratedSourcePage", "aboutToAppear"));
    assertReachable(reachable, methodSignature(scene, "DecoratedSourcePage", "build"));
    assertReachable(reachable, methodSignature(scene, "DecoratedSourcePage", "SearchPanel"));
    assertReachable(reachable, syntheticCarrierCallback.getSignature().toString());
    assertReachable(reachable, methodSignature(scene, "SyntheticDisplayUtility", "getScreenWidth"));
    assertReachable(reachable, methodSignature(scene, "SyntheticCallbackRegistrationTask", "registerOnce"));
    assertReachable(reachable, methodSignature(scene, "SyntheticFactoryTask", "doStart"));
    assertNotReachable(reachable, methodSignature(scene, "PlainPanel", "build"));
    assertNotReachable(reachable, methodSignature(scene, "UnreachableTask", "run"));

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const lifecycleRule = findRuleByAssetId(sourceRules, lifecycleSource.apiEffect.assetId);
    const builderRule = findRuleByAssetId(sourceRules, builderSource.apiEffect.assetId);
    const plainRule = findRuleByAssetId(sourceRules, plainSource.apiEffect.assetId);
    const syntheticUtilityRule = findRuleByAssetId(sourceRules, syntheticUtilitySource.apiEffect.assetId);
    const syntheticCallbackRule = findRuleByAssetId(sourceRules, syntheticCallbackSource.apiEffect.assetId);
    const syntheticTaskRule = findRuleByAssetId(sourceRules, syntheticTaskSource.apiEffect.assetId);
    const unreachableRule = findRuleByAssetId(sourceRules, unreachableSource.apiEffect.assetId);
    assert(
        (seedInfo.sourceRuleHits[lifecycleRule.id] || 0) > 0,
        "source callsite in decorated component lifecycle method should not be excluded by allowed-method filtering",
    );
    assert(
        (seedInfo.sourceRuleHits[builderRule.id] || 0) > 0,
        "source callsite in builder reached from decorated component build should not be excluded by allowed-method filtering",
    );
    assert(
        (seedInfo.sourceRuleHits[syntheticUtilityRule.id] || 0) > 0,
        "utility wrapper source reached by exact synthetic edge should not be excluded by allowed-method filtering",
    );
    assert(
        (seedInfo.sourceRuleHits[syntheticCallbackRule.id] || 0) > 0,
        "callback registration source reached by exact synthetic edge should not be excluded by allowed-method filtering",
    );
    assert(
        (seedInfo.sourceRuleHits[syntheticTaskRule.id] || 0) > 0,
        "task method source reached by exact synthetic edge should not be excluded by allowed-method filtering",
    );
    assert(
        !seedInfo.sourceRuleHits[plainRule.id],
        "plain unreachable method source should not seed",
    );
    assert(
        !seedInfo.sourceRuleHits[unreachableRule.id],
        "unconnected source method should not seed",
    );
    const plainZeroHit = seedInfo.sourceRuleZeroHitAudit.find(entry => entry.ruleId === plainRule.id);
    assert(plainZeroHit, "plain source rule should have zero-hit audit");
    assert(
        plainZeroHit.reason === "source_rule_callsite_outside_allowed_methods",
        `plain source should be excluded by allowed-method filtering, got ${plainZeroHit.reason}`,
    );
    assert(
        plainZeroHit.matchedCallsiteCount > 0 && plainZeroHit.matchedAllowedCallsiteCount === 0,
        `plain source zero-hit audit should show matched but disallowed callsites: ${JSON.stringify(plainZeroHit)}`,
    );
    const unreachableZeroHit = seedInfo.sourceRuleZeroHitAudit.find(entry => entry.ruleId === unreachableRule.id);
    assert(unreachableZeroHit, "unreachable source rule should have zero-hit audit");
    assert(
        unreachableZeroHit.reason === "source_rule_callsite_outside_allowed_methods",
        `unreachable source should be excluded by allowed-method filtering, got ${unreachableZeroHit.reason}`,
    );
    assert(
        unreachableZeroHit.matchedCallsiteCount > 0 && unreachableZeroHit.matchedAllowedCallsiteCount === 0,
        `unreachable zero-hit audit should show matched but disallowed callsites: ${JSON.stringify(unreachableZeroHit)}`,
    );

    console.log("PASS test_entry_model_decorator_component_reachability");
}

main().catch(error => {
    console.error("FAIL test_entry_model_decorator_component_reachability");
    console.error(error);
    process.exit(1);
});
