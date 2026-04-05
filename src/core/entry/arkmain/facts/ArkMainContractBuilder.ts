import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    ArkMainContract,
    ArkMainContractSourceSchema,
    ArkMainEntryFact,
    ArkMainFactKind,
    ArkMainFactOwnership,
    ArkMainOwnerKind,
    ArkMainSurfaceKind,
    ArkMainTriggerKind,
    ArkMainSourceRule,
    ARK_MAIN_LIFECYCLE_FACT_KINDS,
    classifyArkMainFactOwnership,
} from "../ArkMainTypes";
import { ArkMainActivationGraph } from "../edges/ArkMainActivationGraph";
import { ArkMainSchedule } from "../scheduling/ArkMainScheduler";
import { resolveArkMainChannelInvocation } from "./ArkMainChannelInvocationResolver";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";
import { shouldArkMainAutoHintCallbackFact } from "./ArkMainFrameworkCallbackBoundary";

const FORM_BINDING_FIELD_PATHS = [
    ["payload"],
    ["data"],
    ["value"],
    ["content"],
] as const;

export function buildArkMainContracts(
    scene: Scene,
    facts: ArkMainEntryFact[],
    _graph: ArkMainActivationGraph,
    _schedule: ArkMainSchedule,
): ArkMainContract[] {
    const managedOwners = collectFrameworkManagedOwners(scene, { includeComponentContractShape: true });
    const wantHandoffTargetMethodSignatures = new Set(
        facts
            .filter(fact => fact.kind === "want_handoff")
            .map(fact => fact.method.getSignature?.()?.toString?.())
            .filter((signature): signature is string => !!signature),
    );
    return facts.map(fact => buildContractForFact(
        scene,
        managedOwners,
        fact,
        wantHandoffTargetMethodSignatures,
    ));
}

export function buildArkMainSourceRulesFromContracts(
    contracts: ArkMainContract[],
): ArkMainSourceRule[] {
    const out = new Map<string, ArkMainSourceRule>();
    for (const contract of contracts) {
        for (const schema of contract.sourceSchemas) {
            if (!schema.id || out.has(schema.id)) continue;
            out.set(schema.id, {
                id: schema.id,
                enabled: true,
                family: schema.family,
                tier: schema.tier,
                description: schema.description,
                tags: schema.tags,
                match: {
                    kind: "signature_equals",
                    value: schema.matchSignature,
                },
                scope: schema.scopeClassName || schema.scopeMethodName
                    ? {
                        ...(schema.scopeClassName ? { className: { mode: "equals", value: schema.scopeClassName } } : {}),
                        ...(schema.scopeMethodName ? { methodName: { mode: "equals", value: schema.scopeMethodName } } : {}),
                    }
                    : undefined,
                sourceKind: schema.sourceKind,
                target: schema.target,
                callbackArgIndexes: schema.callbackArgIndexes,
            });
        }
    }
    return [...out.values()];
}

function buildContractForFact(
    scene: Scene,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
    fact: ArkMainEntryFact,
    wantHandoffTargetMethodSignatures: Set<string>,
): ArkMainContract {
    const ownerKind = resolveOwnerKind(fact, managedOwners);
    const contract: ArkMainContract = {
        phase: fact.phase,
        method: fact.method,
        ownerKind,
        surface: classifySurface(fact.kind),
        trigger: classifyTrigger(fact.kind),
        boundary: classifyArkMainFactOwnership(fact),
        kind: fact.kind,
        reason: fact.reason,
        sourceMethod: fact.sourceMethod,
        entryFamily: fact.entryFamily,
        entryShape: fact.entryShape,
        recognitionLayer: fact.recognitionLayer,
        callbackFlavor: fact.callbackFlavor,
        callbackShape: fact.callbackShape,
        callbackSlotFamily: fact.callbackSlotFamily,
        callbackRecognitionLayer: fact.callbackRecognitionLayer,
        callbackRegistrationSignature: fact.callbackRegistrationSignature,
        callbackArgIndex: fact.callbackArgIndex,
        callbackStructuralEvidenceFamily: fact.callbackStructuralEvidenceFamily,
        sourceSchemas: [],
    };

    populateLifecycleSourceSchemas(contract, fact, wantHandoffTargetMethodSignatures);
    populateStageContextSourceSchemas(contract, fact);
    populateRouterTriggerSourceSchemas(scene, contract, fact);
    populateUnknownCallbackHintSchemas(contract, fact);
    return contract;
}

function resolveOwnerKind(
    fact: ArkMainEntryFact,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
): ArkMainOwnerKind {
    if (fact.ownerKind) {
        return fact.ownerKind;
    }
    const declaringClass = fact.method.getDeclaringArkClass?.();
    const sourceClass = fact.sourceMethod?.getDeclaringArkClass?.();
    return resolveOwnerKindFromClass(declaringClass, managedOwners)
        || resolveOwnerKindFromClass(sourceClass, managedOwners)
        || defaultOwnerKindForFact(fact.kind);
}

function resolveOwnerKindFromClass(
    cls: ArkClass | null | undefined,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
): ArkMainOwnerKind | undefined {
    if (!cls) return undefined;
    if (managedOwners.isAbilityOwner(cls)) return "ability_owner";
    if (managedOwners.isStageOwner(cls)) return "stage_owner";
    if (managedOwners.isExtensionOwner(cls)) return "extension_owner";
    if (managedOwners.isComponentOwner(cls)) return "component_owner";
    if (managedOwners.isBuilderOwner(cls)) return "builder_owner";
    return undefined;
}

function defaultOwnerKindForFact(kind: ArkMainFactKind): ArkMainOwnerKind {
    if (kind === "page_build" || kind === "page_lifecycle") {
        return "component_owner";
    }
    if (kind === "ability_lifecycle" || kind === "want_handoff") {
        return "ability_owner";
    }
    if (kind === "stage_lifecycle") {
        return "stage_owner";
    }
    if (kind === "extension_lifecycle") {
        return "extension_owner";
    }
    return "unknown_owner";
}

function classifySurface(kind: ArkMainFactKind): ArkMainSurfaceKind {
    if (ARK_MAIN_LIFECYCLE_FACT_KINDS.has(kind)) return "lifecycle";
    if (kind === "callback") return "callback";
    if (kind === "scheduler_callback") return "scheduler";
    if (kind === "watch_handler" || kind === "watch_source") return "watch";
    if (kind === "router_source" || kind === "router_trigger") return "router";
    return "handoff";
}

function classifyTrigger(kind: ArkMainFactKind): ArkMainTriggerKind {
    if (ARK_MAIN_LIFECYCLE_FACT_KINDS.has(kind)) return "root";
    if (kind === "callback") return "callback";
    if (kind === "scheduler_callback") return "scheduler";
    if (kind === "watch_handler" || kind === "watch_source") return "state_watch";
    if (kind === "router_source" || kind === "router_trigger") return "navigation_channel";
    return "ability_handoff";
}

function populateLifecycleSourceSchemas(
    contract: ArkMainContract,
    fact: ArkMainEntryFact,
    wantHandoffTargetMethodSignatures: Set<string>,
): void {
    if (!ARK_MAIN_LIFECYCLE_FACT_KINDS.has(fact.kind)) {
        return;
    }
    const signature = fact.method.getSignature?.()?.toString?.();
    if (!signature) return;
    const isWantHandoffTarget = wantHandoffTargetMethodSignatures.has(signature);

    const parameters = fact.method.getParameters?.() || [];
    parameters.forEach((parameter: any, index: number) => {
        const endpoint = `arg${index}` as const;
        const paramName = String(parameter?.getName?.() || "").toLowerCase();
        const paramType = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const wantLikeParam = isWantLikeParam(paramName, paramType);

        if (!(isWantHandoffTarget && wantLikeParam)) {
            contract.sourceSchemas.push({
                id: `source.arkmain.contract.lifecycle.param.${signature}.${endpoint}`,
                sourceKind: "entry_param",
                family: "source.arkmain.contract.lifecycle.param",
                tier: "A",
                description: `[arkmain contract] ${fact.kind} param ${endpoint} in ${fact.method.getName()}`,
                tags: ["arkmain", "contract_source", "lifecycle", fact.kind],
                matchSignature: signature,
                target: endpoint,
            });
        }

        if (wantLikeParam && !isWantHandoffTarget) {
            contract.sourceSchemas.push({
                id: `source.arkmain.contract.lifecycle.want.${signature}.${endpoint}.parameters`,
                sourceKind: "entry_param",
                family: "source.arkmain.contract.lifecycle.want",
                tier: "A",
                description: `[arkmain contract] ${fact.kind} want.parameters in ${fact.method.getName()}`,
                tags: ["arkmain", "contract_source", "lifecycle", "want", fact.kind],
                matchSignature: signature,
                target: { endpoint, path: ["parameters"] },
            });
        }

        if (isFormBindingLikeParam(paramName, paramType)) {
            contract.sourceSchemas.push({
                id: `source.arkmain.contract.lifecycle.formbinding.${signature}.${endpoint}.root`,
                sourceKind: "entry_param",
                family: "source.arkmain.contract.lifecycle.form_binding",
                tier: "A",
                description: `[arkmain contract] ${fact.kind} form binding root in ${fact.method.getName()}`,
                tags: ["arkmain", "contract_source", "lifecycle", "form_binding", fact.kind],
                matchSignature: signature,
                target: endpoint,
            });

            for (const path of FORM_BINDING_FIELD_PATHS) {
                contract.sourceSchemas.push({
                    id: `source.arkmain.contract.lifecycle.formbinding.${signature}.${endpoint}.${path.join(".")}`,
                    sourceKind: "entry_param",
                    family: "source.arkmain.contract.lifecycle.form_binding",
                    tier: "A",
                    description: `[arkmain contract] ${fact.kind} form binding ${path.join(".")} in ${fact.method.getName()}`,
                    tags: ["arkmain", "contract_source", "lifecycle", "form_binding", fact.kind],
                    matchSignature: signature,
                    target: { endpoint, path: [...path] },
                });
            }
        }
    });
}

function populateStageContextSourceSchemas(contract: ArkMainContract, fact: ArkMainEntryFact): void {
    if (fact.kind !== "stage_lifecycle" || fact.method.getName?.() !== "onCreate") {
        return;
    }

    const className = fact.method.getDeclaringArkClass?.()?.getName?.();
    const methodName = fact.method.getName?.();
    const cfg = fact.method.getCfg?.();
    if (!cfg || !className || !methodName) return;

    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const methodSig = invokeExpr.getMethodSignature?.();
        const calleeSignature = methodSig?.toString?.() || "";
        const calleeName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
        const calleeClassName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (calleeName !== "getContext" || calleeClassName !== "SystemEnv" || !calleeSignature) {
            continue;
        }

        contract.sourceSchemas.push({
            id: `source.arkmain.contract.stage.context.${fact.method.getSignature().toString()}.${calleeSignature}`,
            sourceKind: "call_return",
            family: "source.arkmain.contract.stage.context",
            tier: "A",
            description: `[arkmain contract] stage context source in ${fact.method.getName()}`,
            tags: ["arkmain", "contract_source", "stage_lifecycle", "context_call"],
            matchSignature: calleeSignature,
            scopeClassName: className,
            scopeMethodName: methodName,
            target: { endpoint: "result" },
        });
    }
}

function populateRouterTriggerSourceSchemas(
    scene: Scene,
    contract: ArkMainContract,
    fact: ArkMainEntryFact,
): void {
    if (fact.kind !== "router_trigger") {
        return;
    }
    if (fact.recognitionLayer === "owner_qualified_fallback") {
        return;
    }
    const className = fact.method.getDeclaringArkClass?.()?.getName?.();
    const methodName = fact.method.getName?.();
    const cfg = fact.method.getCfg?.();
    if (!cfg || !className || !methodName) return;

    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const match = resolveArkMainChannelInvocation(scene, fact.method, invokeExpr);
        if (!match || match.factKind !== "router_trigger") {
            continue;
        }
        const calleeSignature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
        if (!calleeSignature) continue;

        contract.sourceSchemas.push({
            id: `source.arkmain.contract.router.trigger.${fact.method.getSignature().toString()}.${calleeSignature}`,
            sourceKind: "call_return",
            family: "source.arkmain.contract.router.trigger",
            tier: "A",
            description: `[arkmain contract] router trigger in ${fact.method.getName()}`,
            tags: ["arkmain", "contract_source", "router_trigger"],
            matchSignature: calleeSignature,
            scopeClassName: className,
            scopeMethodName: methodName,
            target: { endpoint: "result" },
        });
    }
}

function populateUnknownCallbackHintSchemas(contract: ArkMainContract, fact: ArkMainEntryFact): void {
    if (!shouldArkMainAutoHintCallbackFact(fact)) {
        return;
    }

    const parameterCount = fact.method.getParameters?.().length || 0;
    for (let paramIndex = 0; paramIndex < parameterCount; paramIndex++) {
        contract.sourceSchemas.push({
            id: `source.arkmain.callback_hint.${fact.callbackRegistrationSignature}|cbArg:${fact.callbackArgIndex}|param:${paramIndex}`,
            sourceKind: "callback_param",
            family: "arkmain_unknown_callback_hint",
            tier: "C",
            description: `[auto hint] ${fact.entryFamily} callback param arg${paramIndex}`,
            tags: ["auto", "source-hint", "callback_param", fact.entryFamily || "unknown_callback"],
            matchSignature: fact.callbackRegistrationSignature!,
            target: `arg${paramIndex}`,
            callbackArgIndexes: [fact.callbackArgIndex!],
        });
    }
}

function isWantLikeParam(paramName: string, paramType: string): boolean {
    return paramName.includes("want") || paramType.includes("want");
}

function isFormBindingLikeParam(paramName: string, paramType: string): boolean {
    return paramName.includes("formbindingdata")
        || paramName.includes("form_binding_data")
        || paramName.includes("formdata")
        || paramType.includes("formbindingdata");
}
