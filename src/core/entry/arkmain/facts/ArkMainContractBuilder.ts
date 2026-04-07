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
    ArkMainSourceRule,
    ARK_MAIN_LIFECYCLE_FACT_KINDS,
    classifyArkMainFactOwnership,
} from "../ArkMainTypes";
import { ArkMainActivationGraph } from "../edges/ArkMainActivationGraph";
import { ArkMainSchedule } from "../scheduling/ArkMainScheduler";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";

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
    const managedOwners = collectFrameworkManagedOwners(scene);
    return facts.map(fact => buildContractForFact(
        managedOwners,
        fact,
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
            });
        }
    }
    return [...out.values()];
}

function buildContractForFact(
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
    fact: ArkMainEntryFact,
): ArkMainContract {
    const ownerKind = resolveOwnerKind(fact, managedOwners);
    const contract: ArkMainContract = {
        phase: fact.phase,
        method: fact.method,
        ownerKind,
        surface: "lifecycle",
        trigger: "root",
        boundary: classifyArkMainFactOwnership(fact),
        kind: fact.kind,
        reason: fact.reason,
        sourceMethod: fact.sourceMethod,
        entryFamily: fact.entryFamily,
        entryShape: fact.entryShape,
        recognitionLayer: fact.recognitionLayer,
        sourceSchemas: [],
    };

    populateLifecycleSourceSchemas(contract, fact);
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
    return undefined;
}

function defaultOwnerKindForFact(kind: ArkMainFactKind): ArkMainOwnerKind {
    if (kind === "page_build" || kind === "page_lifecycle") {
        return "component_owner";
    }
    if (kind === "ability_lifecycle") {
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

function populateLifecycleSourceSchemas(
    contract: ArkMainContract,
    fact: ArkMainEntryFact,
): void {
    if (!ARK_MAIN_LIFECYCLE_FACT_KINDS.has(fact.kind)) {
        return;
    }
    const signature = fact.method.getSignature?.()?.toString?.();
    if (!signature) return;

    const parameters = fact.method.getParameters?.() || [];
    parameters.forEach((parameter: any, index: number) => {
        const endpoint = `arg${index}` as const;
        const paramName = String(parameter?.getName?.() || "").toLowerCase();
        const paramType = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const wantLikeParam = isWantLikeParam(paramName, paramType);

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

        if (wantLikeParam) {
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

function isWantLikeParam(paramName: string, paramType: string): boolean {
    return paramName.includes("want") || paramType.includes("want");
}

function isFormBindingLikeParam(paramName: string, paramType: string): boolean {
    return paramName.includes("formbindingdata")
        || paramName.includes("form_binding_data")
        || paramName.includes("formdata")
        || paramType.includes("formbindingdata");
}
