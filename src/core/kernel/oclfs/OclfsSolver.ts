import {
    CandidateFlow,
    CurrentnessCertificate,
    CurrentnessObligation,
    CurrentnessVerdict,
    EffectSlice,
    KillStateEffect,
    LoadStateEffect,
    OclfsSolverOptions,
    SinkStateEffect,
    StateCell,
    StateEffect,
    StoreCleanStateEffect,
    StoreStateEffect,
} from "./OclfsTypes";
import {
    canStronglyInvalidateCell,
    compatibleStateCells,
    stateCellKey,
    validateCurrentnessCertificate,
    validateStateEffect,
} from "./OclfsValidation";

interface ActiveProducer {
    effect: StoreStateEffect;
    label: string;
}

export interface OclfsSinkHit {
    sinkEffectId: string;
    sinkId: string;
    valueCell: StateCell;
    label: string;
}

export interface OclfsSolverResult {
    certificates: CurrentnessCertificate[];
    sinkHits: OclfsSinkHit[];
    taintedValueKeys: Set<string>;
}

export class OclfsSolver {
    private readonly options: Required<OclfsSolverOptions>;

    constructor(options: OclfsSolverOptions = {}) {
        this.options = {
            maxSliceEffects: options.maxSliceEffects ?? 128,
            conservativeMay: options.conservativeMay ?? true,
        };
    }

    solve(effects: StateEffect[]): OclfsSolverResult {
        const ordered = [...effects].sort((a, b) => a.sequence - b.sequence);
        for (const effect of ordered) {
            const validation = validateStateEffect(effect);
            if (!validation.valid) {
                throw new Error(`invalid StateEffect ${effect.id}: ${validation.errors.join("; ")}`);
            }
        }

        const taintedValues = new Map<string, Set<string>>();
        const producers: ActiveProducer[] = [];
        const certificates: CurrentnessCertificate[] = [];
        const sinkHits: OclfsSinkHit[] = [];

        const addValueLabel = (cell: StateCell, label: string): void => {
            const key = stateCellKey(cell);
            const bucket = taintedValues.get(key) || new Set<string>();
            if (!taintedValues.has(key)) taintedValues.set(key, bucket);
            bucket.add(label);
        };
        const valueLabels = (cell: StateCell): Set<string> => taintedValues.get(stateCellKey(cell)) || new Set<string>();

        for (const effect of ordered) {
            if (effect.kind === "source") {
                addValueLabel(effect.target, effect.label);
                continue;
            }
            if (effect.kind === "copy") {
                const labels = valueLabels(effect.from);
                for (const label of labels) {
                    addValueLabel(effect.to, label);
                }
                if (effect.label) addValueLabel(effect.to, effect.label);
                continue;
            }
            if (effect.kind === "store") {
                const labels = new Set<string>(valueLabels(effect.value));
                if (effect.label) labels.add(effect.label);
                for (const label of labels) {
                    producers.push({ effect, label });
                }
                continue;
            }
            if (effect.kind === "load") {
                const derivedLabels = this.evaluateLoad(effect, ordered, producers, certificates);
                for (const label of derivedLabels) {
                    addValueLabel(effect.target, label);
                }
                continue;
            }
            if (effect.kind === "sink") {
                const labels = valueLabels(effect.value);
                for (const label of labels) {
                    sinkHits.push({
                        sinkEffectId: effect.id,
                        sinkId: effect.sinkId,
                        valueCell: effect.value,
                        label,
                    });
                }
            }
        }

        return {
            certificates,
            sinkHits,
            taintedValueKeys: new Set(taintedValues.keys()),
        };
    }

    private evaluateLoad(
        load: LoadStateEffect,
        ordered: StateEffect[],
        producers: ActiveProducer[],
        certificates: CurrentnessCertificate[],
    ): Set<string> {
        const derived = new Set<string>();
        for (const producer of producers) {
            if (producer.effect.sequence >= load.sequence) continue;
            const candidate = buildCandidateFlow(producer.effect, load, producer.label);
            const slice = this.buildEffectSlice(candidate, ordered, producer.effect.sequence, load.sequence);
            const certificate = this.checkCurrentness(candidate, slice, ordered, producer.effect, load);
            certificates.push(certificate);
            const validation = validateCurrentnessCertificate(certificate);
            if (!validation.valid) {
                throw new Error(`invalid CurrentnessCertificate ${certificate.id}: ${validation.errors.join("; ")}`);
            }
            if (certificate.verdict === "live"
                || (certificate.verdict === "may-live" && this.options.conservativeMay)
                || (certificate.verdict === "unknown" && this.options.conservativeMay)) {
                derived.add(producer.label);
            }
        }
        return derived;
    }

    private buildEffectSlice(
        candidate: CandidateFlow,
        ordered: StateEffect[],
        producerSequence: number,
        consumerSequence: number,
    ): EffectSlice {
        const between = ordered.filter(effect =>
            effect.sequence > producerSequence
            && effect.sequence < consumerSequence
            && this.effectTouchesCompatibleCell(effect, candidate.consumerCell),
        );
        const truncated = between.length > this.options.maxSliceEffects;
        return {
            id: `slice|${candidate.id}`,
            candidateFlowId: candidate.id,
            effectIds: truncated
                ? between.slice(0, this.options.maxSliceEffects).map(effect => effect.id)
                : between.map(effect => effect.id),
            completeness: truncated ? "truncated" : "complete-for-cell",
        };
    }

    private checkCurrentness(
        candidate: CandidateFlow,
        slice: EffectSlice,
        ordered: StateEffect[],
        producer: StoreStateEffect,
        consumer: LoadStateEffect,
    ): CurrentnessCertificate {
        const obligations: CurrentnessObligation[] = [];
        const linkCompatibility = resolveLinkCompatibility(candidate, slice, ordered);
        const directCompatibility = compatibleStateCells(candidate.producerCell, candidate.consumerCell);
        const compatibility = directCompatibility === "no" ? linkCompatibility.compatibility : directCompatibility;
        if (compatibility === "no") {
            obligations.push({
                kind: "identity",
                status: "refuted",
                subject: [candidate.producerCell.id, candidate.consumerCell.id],
                reason: "incompatible_cell",
            });
            return this.certificate(candidate, "blocked-mismatch", obligations, slice, {
                primaryReason: "incompatible_cell",
                proofStatus: "refutation-proof",
                confidence: "certain",
            });
        }
        obligations.push({
            kind: "identity",
            status: compatibility === "exact" ? "discharged" : "unresolved",
            subject: [candidate.producerCell.id, candidate.consumerCell.id],
            reason: compatibility === "exact"
                ? (linkCompatibility.effectId ? "exact_linked_cell" : "exact_cell")
                : "may_compatible_cell",
        });
        if (linkCompatibility.effectId) {
            obligations.push({
                kind: "link-scope",
                status: compatibility === "exact" ? "discharged" : "unresolved",
                evidenceEffectIds: [linkCompatibility.effectId],
                reason: compatibility === "exact" ? "link_scope_active" : "link_scope_uncertain",
            });
        }

        if (slice.completeness === "truncated" || slice.completeness === "unknown") {
            obligations.push({
                kind: "slice-completeness",
                status: "unresolved",
                evidenceEffectIds: slice.effectIds,
                reason: "slice_incomplete",
            });
            return this.certificate(candidate, "unknown", obligations, slice, {
                primaryReason: "slice_incomplete",
                proofStatus: "unknown-proof",
                confidence: "unknown",
                uncertaintyReasons: ["slice_incomplete"],
            });
        }

        obligations.push({
            kind: "slice-completeness",
            status: "discharged",
            evidenceEffectIds: slice.effectIds,
            reason: slice.completeness,
        });

        if (producer.confidence === "unknown" || consumer.confidence === "unknown") {
            obligations.push({
                kind: "model-confidence",
                status: "unresolved",
                evidenceEffectIds: [producer.id, consumer.id],
                reason: "unknown_model_confidence",
            });
            return this.certificate(candidate, "unknown", obligations, slice, {
                primaryReason: "unknown_model_confidence",
                proofStatus: "unknown-proof",
                confidence: "unknown",
                uncertaintyReasons: ["unknown_model_confidence"],
            });
        }

        const invalidators = ordered.filter((effect): effect is StoreCleanStateEffect | KillStateEffect =>
            effect.sequence > producer.sequence
            && effect.sequence < consumer.sequence
            && isInvalidatorEffect(effect)
            && compatibleStateCells(effect.location, candidate.consumerCell) !== "no",
        );

        const exactStrongInvalidator = invalidators.find(effect =>
            compatibleStateCells(effect.location, candidate.consumerCell) === "exact"
            && (effect.updateStrength || "infer") !== "weak"
            && effect.confidence !== "unknown"
            && canStronglyInvalidateCell(effect.location),
        );
        const weakOrMayInvalidator = invalidators.find(effect =>
            !exactStrongInvalidator
            && (compatibleStateCells(effect.location, candidate.consumerCell) === "may"
                || (effect.updateStrength || "infer") === "weak"
                || effect.confidence === "unknown"
                || !canStronglyInvalidateCell(effect.location)),
        );

        if (exactStrongInvalidator) {
            obligations.push({
                kind: "update-strength",
                status: "discharged",
                evidenceEffectIds: [exactStrongInvalidator.id],
                reason: "strong_invalidator",
            });
            obligations.push({
                kind: "definite-effect-order",
                status: "discharged",
                evidenceEffectIds: [producer.id, exactStrongInvalidator.id, consumer.id],
                reason: "producer_before_invalidator_before_consumer",
            });
            return this.certificate(candidate, "dead", obligations, slice, {
                primaryReason: exactStrongInvalidator.kind === "kill" ? "strong_kill" : "strong_clean_overwrite",
                proofStatus: "refutation-proof",
                confidence: "certain",
                blockedByEffectIds: [exactStrongInvalidator.id],
            });
        }

        if (weakOrMayInvalidator || compatibility === "may") {
            obligations.push({
                kind: "no-strong-invalidator",
                status: "unresolved",
                evidenceEffectIds: invalidators.map(effect => effect.id),
                reason: weakOrMayInvalidator ? "may_or_weak_invalidator" : "may_compatible_cell",
            });
            return this.certificate(candidate, "may-live", obligations, slice, {
                primaryReason: weakOrMayInvalidator ? "may_or_weak_invalidator" : "may_compatible_cell",
                proofStatus: "partial-proof",
                confidence: "likely",
                uncertaintyReasons: [weakOrMayInvalidator ? "may_or_weak_invalidator" : "may_compatible_cell"],
            });
        }

        obligations.push({
            kind: "freshness",
            status: "discharged",
            evidenceEffectIds: [producer.id, consumer.id],
            reason: "producer_reaches_consumer",
        });
        obligations.push({
            kind: "no-strong-invalidator",
            status: "discharged",
            evidenceEffectIds: slice.effectIds,
            reason: "no_intervening_update",
        });
        return this.certificate(candidate, "live", obligations, slice, {
            primaryReason: "no_intervening_update",
            proofStatus: "complete-proof",
            confidence: "certain",
            decisiveEffectIds: [producer.id, consumer.id],
        });
    }

    private effectTouchesCompatibleCell(effect: StateEffect, cell: StateCell): boolean {
        const cells = cellsTouchedByEffect(effect);
        return cells.some(candidate => compatibleStateCells(candidate, cell) !== "no");
    }

    private certificate(
        candidate: CandidateFlow,
        verdict: CurrentnessVerdict,
        obligations: CurrentnessObligation[],
        slice: EffectSlice,
        details: {
            primaryReason: string;
            proofStatus: CurrentnessCertificate["proofStatus"];
            confidence: CurrentnessCertificate["confidence"];
            decisiveEffectIds?: string[];
            blockedByEffectIds?: string[];
            uncertaintyReasons?: string[];
        },
    ): CurrentnessCertificate {
        return {
            id: `currentness|${candidate.id}`,
            candidateFlow: candidate,
            verdict,
            obligations,
            sliceCompleteness: slice.completeness,
            decisiveEffectIds: details.decisiveEffectIds,
            blockedByEffectIds: details.blockedByEffectIds,
            primaryReason: details.primaryReason,
            uncertaintyReasons: details.uncertaintyReasons,
            proofStatus: details.proofStatus,
            confidence: details.confidence,
        };
    }
}

function buildCandidateFlow(
    producer: StoreStateEffect,
    consumer: LoadStateEffect,
    label: string,
): CandidateFlow {
    return {
        id: `${producer.id}->${consumer.id}|${label}`,
        producerEffectId: producer.id,
        consumerEffectId: consumer.id,
        producerCell: producer.location,
        consumerCell: consumer.location,
        label,
    };
}

function cellsTouchedByEffect(effect: StateEffect): StateCell[] {
    if (effect.kind === "store") return [effect.location, effect.value];
    if (effect.kind === "load") return [effect.location, effect.target];
    if (effect.kind === "store-clean" || effect.kind === "kill") return [effect.location];
    if (effect.kind === "copy" || effect.kind === "sanitize") return [effect.from, effect.to];
    if (effect.kind === "source") return [effect.target];
    if (effect.kind === "sink") return [effect.value];
    if (effect.kind === "link" || effect.kind === "unlink") return [effect.left, effect.right];
    return [];
}

function isInvalidatorEffect(effect: StateEffect): effect is StoreCleanStateEffect | KillStateEffect {
    return effect.kind === "store-clean" || effect.kind === "kill";
}

function resolveLinkCompatibility(
    candidate: CandidateFlow,
    slice: EffectSlice,
    ordered: StateEffect[],
): { compatibility: "exact" | "may" | "no"; effectId?: string } {
    let sawMay = false;
    for (const effectId of slice.effectIds) {
        const effect = ordered.find(item => item.id === effectId);
        if (!effect || effect.kind !== "link") continue;
        const leftToProducer = compatibleStateCells(effect.left, candidate.producerCell);
        const rightToConsumer = compatibleStateCells(effect.right, candidate.consumerCell);
        const rightToProducer = compatibleStateCells(effect.right, candidate.producerCell);
        const leftToConsumer = compatibleStateCells(effect.left, candidate.consumerCell);
        if ((leftToProducer === "exact" && rightToConsumer === "exact")
            || (rightToProducer === "exact" && leftToConsumer === "exact")) {
            return { compatibility: "exact", effectId: effect.id };
        }
        if (leftToProducer !== "no" && rightToConsumer !== "no") sawMay = true;
        if (rightToProducer !== "no" && leftToConsumer !== "no") sawMay = true;
    }
    return { compatibility: sawMay ? "may" : "no" };
}
