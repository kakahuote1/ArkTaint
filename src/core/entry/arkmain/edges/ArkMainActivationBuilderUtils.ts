import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    ArkMainActivationReason,
} from "./ArkMainActivationTypes";

export function reasonFromFact(fact: ArkMainEntryFact): ArkMainActivationReason {
    return {
        kind: "entry_fact",
        summary: fact.reason,
        evidenceFactKind: fact.kind,
        evidenceMethod: fact.sourceMethod || fact.method,
        entryFamily: fact.entryFamily,
        recognitionLayer: fact.recognitionLayer,
    };
}

export function reasonFromScenarioSeed(method: ArkMethod): ArkMainActivationReason {
    return {
        kind: "baseline_root",
        summary: `Scenario seed ${method.getName()}`,
        evidenceMethod: method,
    };
}

export function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}

