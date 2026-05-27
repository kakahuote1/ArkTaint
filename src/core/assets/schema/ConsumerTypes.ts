import type { ProgramPoint, ValidationResult } from "./CommonTypes";
import type { SemanticEmission } from "./EmissionTypes";
import type { SemanticEffectInstance } from "./EffectInstanceTypes";
import type { SemanticEffectKind } from "./EffectTemplateTypes";

export type ConsumerMode =
    | "pre-analysis"
    | "during-fixpoint"
    | "post-analysis";

export interface AnalysisContext {
    readonly runId?: string;
}

export interface PreparedEffectSet {
    readonly effectIds: string[];
}

export interface DataFlowState {
    readonly stateId?: string;
}

export interface TransferResult {
    emissions: SemanticEmission[];
    state?: DataFlowState;
}

export interface SemanticEffectConsumer {
    family: string;
    mode: ConsumerMode;
    accepts(kind: SemanticEffectKind): boolean;
    validate(instance: SemanticEffectInstance): ValidationResult;
    prepare?(
        instances: SemanticEffectInstance[],
        context: AnalysisContext
    ): PreparedEffectSet;
    transferAt?(
        programPoint: ProgramPoint,
        inState: DataFlowState,
        prepared: PreparedEffectSet,
        context: AnalysisContext
    ): TransferResult;
    consumeBatch?(
        instances: SemanticEffectInstance[],
        context: AnalysisContext
    ): SemanticEmission[];
}

export interface EffectFamilySpec {
    family: string;
    allowedKinds: string[];
    schema: Record<string, unknown>;
    consumer: string;
    consumerMode: ConsumerMode;
    llmAllowed: boolean;
    projectModelAllowed: boolean;
    emits: string[];
}
