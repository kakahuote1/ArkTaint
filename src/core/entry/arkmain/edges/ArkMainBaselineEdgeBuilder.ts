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
    const hasEntryComponentRoot = baselineFacts.some(fact =>
        isComponentLifecycleFact(fact) && hasEntryDecorator(fact.method),
    );
    const hasManagedSeedMethod = baselineFacts.some(fact => {
        const signature = fact.method.getSignature?.()?.toString?.();
        return !!signature && seedSignatures.has(signature);
    });
    for (const fact of baselineFacts) {
        const signature = fact.method.getSignature?.()?.toString?.();
        const matchesSeedMethod = !!signature && seedSignatures.has(signature);
        const matchesSeedFile = !hasManagedSeedMethod
            && seedFileKeys.size > 0
            && seedFileKeys.has(methodFileKey(fact.method) || "");
        if (
            isComponentLifecycleFact(fact)
            && hasEntryComponentRoot
            && !hasEntryDecorator(fact.method)
            && !matchesSeedMethod
            && !matchesSeedFile
        ) {
            continue;
        }
        if (seedSignatures.size > 0) {
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

function isComponentLifecycleFact(fact: ArkMainEntryFact): boolean {
    return fact.kind === "page_build" || fact.kind === "page_lifecycle";
}

function hasEntryDecorator(method: ArkMethod): boolean {
    const decorators = method.getDeclaringArkClass?.()?.getDecorators?.() || [];
    return decorators.some(decorator => normalizeDecoratorKind(decorator?.getKind?.()) === "Entry");
}

function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}


