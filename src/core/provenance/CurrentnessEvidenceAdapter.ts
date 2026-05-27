import type { CurrentnessCertificate } from "../kernel/oclfs";
import type { CurrentnessConservativePolicy, CurrentnessEvidence } from "./ProvenancePathTypes";

export function currentnessEvidenceFromCertificate(
    certificate: CurrentnessCertificate,
    conservativePolicy: CurrentnessConservativePolicy = "derive-on-may",
): CurrentnessEvidence {
    return {
        id: `evidence|${certificate.id}`,
        kind: "currentness",
        candidateFlowId: certificate.candidateFlow.id,
        candidateFlow: certificate.candidateFlow,
        producerEffectId: certificate.candidateFlow.producerEffectId,
        consumerEffectId: certificate.candidateFlow.consumerEffectId,
        producerCell: certificate.candidateFlow.producerCell,
        consumerCell: certificate.candidateFlow.consumerCell,
        label: certificate.candidateFlow.label,
        verdict: certificate.verdict,
        obligations: certificate.obligations,
        sliceCompleteness: certificate.sliceCompleteness,
        proofStatus: certificate.proofStatus,
        primaryReason: certificate.primaryReason,
        uncertaintyReasons: certificate.uncertaintyReasons,
        decisiveEffectIds: certificate.decisiveEffectIds,
        blockedByEffectIds: certificate.blockedByEffectIds,
        decisionScope: "candidate-flow",
        conservativePolicy,
        confidence: certificate.confidence,
        producer: "algorithm_e_oclfs",
    };
}
