import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationReason } from "../edges/ArkMainActivationTypes";
import { ArkMainSchedule, ArkMainScheduledMethod } from "../scheduling/ArkMainScheduler";
import {
    ArkMainActivationExplanation,
    ArkMainExplainabilityReport,
    ArkMainReasonRecord,
    ArkMainSupportingEdgeRecord,
} from "./ArkMainExplainabilityTypes";

export function buildArkMainExplainabilityReport(schedule: ArkMainSchedule): ArkMainActivationExplanation[] {
    return buildArkMainExplainabilityBundle(schedule).activations;
}

export function buildArkMainExplainabilityBundle(schedule: ArkMainSchedule): ArkMainExplainabilityReport {
    const activations = schedule.activations.map(activation => ({
        signature: signatureOf(activation.method)!,
        methodName: activation.method.getName?.() || "@unknown",
        declaringClass: activation.method.getDeclaringArkClass?.()?.getName?.() || "@global",
        phase: activation.phase,
        round: activation.round,
        activationEdgeKinds: [...activation.activationEdgeKinds].sort(),
        activationEdgeFamilies: [...activation.activationEdgeFamilies].sort(),
        reasons: normalizeReasons(activation.reasons),
        supportingEdges: normalizeSupportingEdges(activation),
    })).sort((a, b) => a.signature.localeCompare(b.signature));

    return {
        schemaVersion: "arkmain.explainability.v2",
        summary: {
            activationCount: activations.length,
            phaseCounts: buildPhaseCounts(activations),
            activationEdgeKindCounts: buildActivationEdgeKindCounts(activations),
            activationEdgeFamilyCounts: buildActivationEdgeFamilyCounts(activations),
            scheduling: {
                maxRounds: schedule.convergence.maxRounds,
                roundsExecuted: schedule.convergence.roundsExecuted,
                lastChangedRound: schedule.convergence.lastChangedRound,
                converged: schedule.convergence.converged,
                truncated: schedule.convergence.truncated,
                warnings: [...schedule.warnings],
            },
        },
        activations,
    };
}

function normalizeSupportingEdges(activation: ArkMainScheduledMethod): ArkMainSupportingEdgeRecord[] {
    return activation.supportingEdges.map(edge => ({
            kind: edge.kind,
            edgeFamily: edge.edgeFamily,
            phaseHint: edge.phaseHint,
            fromSignature: signatureOf(edge.fromMethod),
            fromName: edge.fromMethod?.getName?.(),
            toSignature: signatureOf(edge.toMethod)!,
            toName: edge.toMethod.getName?.() || "@unknown",
        }))
        .sort((left, right) => {
            const leftKey = `${left.kind}|${left.edgeFamily}|${left.phaseHint}|${left.fromSignature || "@root"}|${left.toSignature}`;
            const rightKey = `${right.kind}|${right.edgeFamily}|${right.phaseHint}|${right.fromSignature || "@root"}|${right.toSignature}`;
            return leftKey.localeCompare(rightKey);
        });
}

function normalizeReasons(reasons: ArkMainActivationReason[]): ArkMainReasonRecord[] {
    const seen = new Set<string>();
    const out: ArkMainReasonRecord[] = [];
    for (const reason of reasons) {
        const evidenceSignature = signatureOf(reason.evidenceMethod);
        const key = [
            reason.kind,
            reason.summary,
            reason.evidenceFactKind || "",
            evidenceSignature || "",
            reason.entryFamily || "",
            reason.recognitionLayer || "",
            reason.callbackShape || "",
            reason.callbackSlotFamily || "",
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            kind: reason.kind,
            summary: reason.summary,
            evidenceFactKind: reason.evidenceFactKind,
            evidenceMethodSignature: evidenceSignature,
            evidenceMethodName: reason.evidenceMethod?.getName?.(),
            entryFamily: reason.entryFamily,
            recognitionLayer: reason.recognitionLayer,
            callbackShape: reason.callbackShape,
            callbackSlotFamily: reason.callbackSlotFamily,
        });
    }
    return out.sort((left, right) => {
        const leftKey = [
            left.kind,
            left.summary,
            left.evidenceFactKind || "",
            left.evidenceMethodSignature || "",
            left.entryFamily || "",
            left.recognitionLayer || "",
            left.callbackShape || "",
            left.callbackSlotFamily || "",
        ].join("|");
        const rightKey = [
            right.kind,
            right.summary,
            right.evidenceFactKind || "",
            right.evidenceMethodSignature || "",
            right.entryFamily || "",
            right.recognitionLayer || "",
            right.callbackShape || "",
            right.callbackSlotFamily || "",
        ].join("|");
        return leftKey.localeCompare(rightKey);
    });
}

function buildPhaseCounts(activations: ArkMainActivationExplanation[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const activation of activations) {
        out[activation.phase] = (out[activation.phase] || 0) + 1;
    }
    return sortRecord(out);
}

function buildActivationEdgeKindCounts(activations: ArkMainActivationExplanation[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const activation of activations) {
        for (const kind of activation.activationEdgeKinds) {
            out[kind] = (out[kind] || 0) + 1;
        }
    }
    return sortRecord(out);
}

function buildActivationEdgeFamilyCounts(activations: ArkMainActivationExplanation[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const activation of activations) {
        for (const family of activation.activationEdgeFamilies) {
            out[family] = (out[family] || 0) + 1;
        }
    }
    return sortRecord(out);
}

function sortRecord(input: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of Object.keys(input).sort((a, b) => a.localeCompare(b))) {
        out[key] = input[key];
    }
    return out;
}

function signatureOf(method?: ArkMethod): string | undefined {
    return method?.getSignature?.()?.toString?.();
}


