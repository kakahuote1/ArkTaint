import { ArkMethod } from "../../../../../arkanalyzer/lib/core/model/ArkMethod";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    ArkMainActivationReason,
} from "./ArkMainActivationTypes";

export function matchesWatchTargets(anchor: ArkMainEntryFact, watchFact: ArkMainEntryFact): boolean {
    const watchTargets = watchFact.watchTargets || [];
    if (watchTargets.length === 0) return true;
    const reactiveFieldNames = anchor.reactiveFieldNames || [];
    if (reactiveFieldNames.length === 0) return true;
    return watchTargets.some(target => reactiveFieldNames.includes(target));
}

export function reasonFromFact(fact: ArkMainEntryFact): ArkMainActivationReason {
    return {
        kind: "entry_fact",
        summary: fact.reason,
        evidenceFactKind: fact.kind,
        evidenceMethod: fact.sourceMethod || fact.method,
        entryFamily: fact.entryFamily,
        recognitionLayer: fact.callbackRecognitionLayer || fact.recognitionLayer,
        callbackShape: fact.callbackShape,
        callbackSlotFamily: fact.callbackSlotFamily,
    };
}

export function reasonFromScenarioSeed(method: ArkMethod): ArkMainActivationReason {
    return {
        kind: "baseline_root",
        summary: `Scenario seed ${method.getName()}`,
        evidenceMethod: method,
    };
}

export function findClassLocalAnchors(facts: ArkMainEntryFact[], targetMethod: ArkMethod): ArkMainEntryFact[] {
    const className = targetMethod.getDeclaringArkClass?.()?.getName?.();
    const localFacts = facts.filter(f => f.method.getDeclaringArkClass?.()?.getName?.() === className);
    return localFacts.length > 0 ? localFacts : facts;
}

export function findCompositionAnchors(
    compositionFacts: ArkMainEntryFact[],
    targetMethod: ArkMethod,
    fallback?: ArkMethod,
): ArkMethod[] {
    const targetClass = targetMethod.getDeclaringArkClass?.()?.getName?.();
    const anchors = compositionFacts
        .map(f => f.method)
        .filter(method => {
            const className = method.getDeclaringArkClass?.()?.getName?.();
            return className === targetClass && signatureOf(method) !== signatureOf(targetMethod);
        });
    if (anchors.length > 0) {
        return dedupeMethods(anchors);
    }
    return fallback ? [fallback] : [targetMethod];
}

export function findParentBuildAnchors(
    compositionFacts: ArkMainEntryFact[],
    targetMethod: ArkMethod,
    fallback?: ArkMethod,
): ArkMethod[] {
    const targetClass = targetMethod.getDeclaringArkClass?.()?.getName?.();
    const parentBuilds = compositionFacts
        .filter(f => f.kind === "page_build")
        .map(f => f.method)
        .filter(method => method.getDeclaringArkClass?.()?.getName?.() !== targetClass);
    if (parentBuilds.length > 0) {
        return dedupeMethods(parentBuilds);
    }
    return fallback ? [fallback] : [targetMethod];
}

export function findAbilityBootstrapAnchors(
    bootstrapFacts: ArkMainEntryFact[],
    targetMethod: ArkMethod,
): ArkMethod[] {
    const targetClass = targetMethod.getDeclaringArkClass?.()?.getName?.();
    const localBootstrap = bootstrapFacts
        .map(f => f.method)
        .filter(method => method.getDeclaringArkClass?.()?.getName?.() === targetClass);
    const preferredOnCreate = localBootstrap.filter(method => method.getName?.() === "onCreate");
    if (preferredOnCreate.length > 0) {
        return dedupeMethods(preferredOnCreate);
    }
    if (localBootstrap.length > 0) {
        return dedupeMethods(localBootstrap);
    }
    return [targetMethod];
}

export function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = signatureOf(method);
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}

export function signatureOf(method?: ArkMethod): string | undefined {
    return method?.getSignature?.()?.toString?.();
}


