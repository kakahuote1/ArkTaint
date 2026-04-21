import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { ARK_MAIN_LIFECYCLE_FACT_KINDS } from "../ArkMainTypes";
import { dedupeMethods, reasonFromFact, reasonFromScenarioSeed } from "./ArkMainActivationBuilderUtils";

export function buildBaselineRootEdges(
    facts: ArkMainEntryFact[],
    seedMethods: ArkMethod[],
): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const seedSignatures = new Set(
        dedupeMethods(seedMethods)
            .map(method => method.getSignature?.()?.toString?.())
            .filter((signature): signature is string => Boolean(signature)),
    );
    const seedFileKeys = new Set(
        dedupeMethods(seedMethods)
            .map(methodFileKey)
            .filter((fileKey): fileKey is string => Boolean(fileKey)),
    );
    const baselineFacts = facts.filter(f =>
        f.schedule !== false
        && ARK_MAIN_LIFECYCLE_FACT_KINDS.has(f.kind),
    );
    const hasManagedSeedMethod = baselineFacts.some(fact => {
        const signature = fact.method.getSignature?.()?.toString?.();
        return !!signature && seedSignatures.has(signature);
    });
    for (const fact of baselineFacts) {
        const signature = fact.method.getSignature?.()?.toString?.();
        if (seedSignatures.size > 0) {
            const matchesSeedMethod = !!signature && seedSignatures.has(signature);
            const matchesSeedFile = !hasManagedSeedMethod
                && seedFileKeys.size > 0
                && seedFileKeys.has(methodFileKey(fact.method) || "");
            if (!matchesSeedMethod && !matchesSeedFile) {
                continue;
            }
        }
        edges.push({
            kind: "baseline_root",
            edgeFamily: "baseline_root",
            phaseHint: fact.phase,
            toMethod: fact.method,
            reasons: [reasonFromFact(fact)],
        });
    }

    for (const method of dedupeMethods(seedMethods)) {
        edges.push({
            kind: "baseline_root",
            edgeFamily: "baseline_root",
            phaseHint: "bootstrap",
            toMethod: method,
            reasons: [reasonFromScenarioSeed(method)],
        });
    }
    return edges;
}

function methodFileKey(method: ArkMethod): string | undefined {
    return method.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.();
}


