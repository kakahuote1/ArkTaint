import { TaintFlow } from "../kernel/model/TaintFlow";
import type { FactPredecessorRecord } from "../kernel/propagation/PropagationTypes";
import {
    BaseEvidenceGraph,
    CurrentnessEvidence,
    MaterializedTaintFlow,
    PathGap,
    PathMaterializationOptions,
    ProvenancePathContext,
} from "./ProvenancePathTypes";
import { materializeTaintFlowPaths } from "./ProvenancePathRecorder";

export class BaseEvidenceGraphRecorder {
    private readonly derivations: FactPredecessorRecord[] = [];
    private readonly currentness: CurrentnessEvidence[] = [];
    private readonly gaps: PathGap[] = [];

    derive(atom: FactPredecessorRecord): void {
        this.derivations.push(cloneDerivation(atom));
    }

    currentnessEvidence(evidence: CurrentnessEvidence): void {
        this.currentness.push(cloneCurrentness(evidence));
    }

    gap(gap: PathGap): void {
        this.gaps.push({ ...gap });
    }

    snapshot(): BaseEvidenceGraph {
        return {
            derivations: this.derivations.map(cloneDerivation),
            currentness: this.currentness.map(cloneCurrentness),
            gaps: this.gaps.map(gap => ({ ...gap })),
        };
    }
}

export function materializeFlowFromBaseEvidenceGraph(
    flow: TaintFlow,
    graph: BaseEvidenceGraph,
    context: Pick<ProvenancePathContext, "observedFactsById">,
    options?: PathMaterializationOptions,
): MaterializedTaintFlow | undefined {
    const predecessorMap = new Map<string, FactPredecessorRecord[]>();
    for (const derivation of graph.derivations) {
        const bucket = predecessorMap.get(derivation.toFactId) || [];
        predecessorMap.set(derivation.toFactId, bucket);
        bucket.push(cloneDerivation(derivation));
    }
    const currentnessById = new Map(graph.currentness.map(item => [item.id, cloneCurrentness(item)]));
    const materialized = materializeTaintFlowPaths(flow, {
        observedFactsById: context.observedFactsById,
        factPredecessorsByFactId: predecessorMap,
        currentnessEvidenceById: currentnessById,
    }, options);
    if (!materialized) {
        return undefined;
    }
    const existingGaps = materialized.gaps || [];
    return {
        ...materialized,
        gaps: [
            ...existingGaps,
            ...graph.gaps.map(gap => ({ ...gap })),
        ],
    };
}

function cloneDerivation(atom: FactPredecessorRecord): FactPredecessorRecord {
    return {
        ...atom,
        currentnessCertificateIds: atom.currentnessCertificateIds
            ? [...atom.currentnessCertificateIds]
            : undefined,
        currentnessCertificates: atom.currentnessCertificates
            ? atom.currentnessCertificates.map(cert => ({ ...cert }))
            : undefined,
    };
}

function cloneCurrentness(evidence: CurrentnessEvidence): CurrentnessEvidence {
    return {
        ...evidence,
        obligations: evidence.obligations.map(obligation => ({ ...obligation })),
        uncertaintyReasons: evidence.uncertaintyReasons ? [...evidence.uncertaintyReasons] : undefined,
        decisiveEffectIds: evidence.decisiveEffectIds ? [...evidence.decisiveEffectIds] : undefined,
        blockedByEffectIds: evidence.blockedByEffectIds ? [...evidence.blockedByEffectIds] : undefined,
    };
}
