import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact, ARK_MAIN_LIFECYCLE_FACT_KINDS, ArkMainPhaseName } from "../ArkMainTypes";
import { getArkMainPhaseRank, getArkMainTargetPhase } from "../scheduling/ArkMainSchedulingRules";
import { reasonFromFact } from "./ArkMainActivationBuilderUtils";

type LifecycleProgressionEdgeFamily =
    | "composition_lifecycle"
    | "interaction_lifecycle"
    | "teardown_lifecycle";

export function buildLifecycleProgressionEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const lifecycleFacts = facts.filter(fact =>
        fact.schedule !== false && ARK_MAIN_LIFECYCLE_FACT_KINDS.has(fact.kind),
    );
    const factsByClass = new Map<string, ArkMainEntryFact[]>();
    for (const fact of lifecycleFacts) {
        const ownerIdentity = getLifecycleOwnerIdentity(fact);
        if (!ownerIdentity) continue;
        if (!factsByClass.has(ownerIdentity)) {
            factsByClass.set(ownerIdentity, []);
        }
        factsByClass.get(ownerIdentity)!.push(fact);
    }

    for (const classFacts of factsByClass.values()) {
        const byPhase = new Map<ArkMainPhaseName, ArkMainEntryFact[]>();
        for (const fact of classFacts) {
            if (!byPhase.has(fact.phase)) {
                byPhase.set(fact.phase, []);
            }
            byPhase.get(fact.phase)!.push(fact);
        }
        const phases = [...byPhase.keys()].sort((left, right) => getArkMainPhaseRank(left) - getArkMainPhaseRank(right));
        for (let index = 1; index < phases.length; index++) {
            const targetPhase = phases[index];
            const sourcePhase = phases[index - 1];
            const edgeFamily = resolveLifecycleProgressionEdgeFamily(targetPhase);
            if (!edgeFamily) continue;
            const sourceFacts = byPhase.get(sourcePhase) || [];
            const targetFacts = byPhase.get(targetPhase) || [];
            for (const targetFact of targetFacts) {
                for (const sourceFact of sourceFacts) {
                    const sourceSignature = sourceFact.method.getSignature?.()?.toString?.();
                    const targetSignature = targetFact.method.getSignature?.()?.toString?.();
                    if (!sourceSignature || !targetSignature || sourceSignature === targetSignature) {
                        continue;
                    }
                    edges.push({
                        kind: "lifecycle_progression",
                        edgeFamily,
                        phaseHint: getArkMainTargetPhase(edgeFamily),
                        fromMethod: sourceFact.method,
                        toMethod: targetFact.method,
                        reasons: [reasonFromFact(sourceFact), reasonFromFact(targetFact)],
                    });
                }
            }
        }
    }

    return edges;
}

function getLifecycleOwnerIdentity(fact: ArkMainEntryFact): string {
    const declaringClass = fact.method.getDeclaringArkClass?.();
    const classSig = declaringClass?.getSignature?.();
    if (classSig?.toString?.()) {
        return classSig.toString();
    }
    const className = declaringClass?.getName?.() || "";
    if (!className) return "";
    const fileSig = classSig?.getDeclaringFileSignature?.()?.toString?.() || "";
    return fileSig ? `${fileSig}::${className}` : className;
}

function resolveLifecycleProgressionEdgeFamily(
    targetPhase: ArkMainPhaseName,
): LifecycleProgressionEdgeFamily | undefined {
    if (targetPhase === "composition") return "composition_lifecycle";
    if (targetPhase === "interaction") return "interaction_lifecycle";
    if (targetPhase === "teardown") return "teardown_lifecycle";
    return undefined;
}
