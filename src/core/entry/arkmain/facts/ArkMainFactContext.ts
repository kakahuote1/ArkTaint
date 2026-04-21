import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    ARK_MAIN_PHASE_ORDER,
    ArkMainEntryFact,
    ArkMainPhaseName,
} from "../ArkMainTypes";

export interface ArkMainFactCollectionContext {
    facts: ArkMainEntryFact[];
    explicitSeedMethods: ArkMethod[];
    phaseByMethodSignature: Map<string, ArkMainPhaseName>;
    phaseCandidateMethods: Map<ArkMainPhaseName, ArkMethod[]>;
    addFact: (fact: ArkMainEntryFact) => void;
    addPhaseCandidateMethod: (phase: ArkMainPhaseName, method: ArkMethod) => void;
}

export function createArkMainFactCollectionContext(explicitSeedMethods: ArkMethod[] = []): ArkMainFactCollectionContext {
    const facts: ArkMainEntryFact[] = [];
    const seen = new Set<string>();
    const phaseByMethodSignature = new Map<string, ArkMainPhaseName>();
    const phaseCandidateMethods = new Map<ArkMainPhaseName, ArkMethod[]>();
    for (const phase of ARK_MAIN_PHASE_ORDER) {
        phaseCandidateMethods.set(phase, []);
    }

    for (const method of explicitSeedMethods) {
        phaseCandidateMethods.get("bootstrap")!.push(method);
        const signature = method.getSignature?.()?.toString?.();
        if (signature && !phaseByMethodSignature.has(signature)) {
            phaseByMethodSignature.set(signature, "bootstrap");
        }
    }

    return {
        facts,
        explicitSeedMethods,
        phaseByMethodSignature,
        phaseCandidateMethods,
        addFact: (fact: ArkMainEntryFact): void => {
            const signature = fact.method?.getSignature?.()?.toString?.();
            if (!signature) return;
            const key = `${fact.phase}|${fact.kind}|${signature}`;
            if (seen.has(key)) return;
            seen.add(key);
            facts.push(fact);
        },
        addPhaseCandidateMethod: (phase: ArkMainPhaseName, method: ArkMethod): void => {
            phaseCandidateMethods.get(phase)!.push(method);
            const signature = method.getSignature?.()?.toString?.();
            if (signature && !phaseByMethodSignature.has(signature)) {
                phaseByMethodSignature.set(signature, phase);
            }
        },
    };
}


