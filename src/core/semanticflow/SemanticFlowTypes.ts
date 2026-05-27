import type { AssetDocumentBase, AssetPlane } from "../assets/schema";
import type {
    SanitizerRule,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "../rules/RuleSchema";

export type SemanticFlowSliceTemplate =
    | "owner-slot"
    | "call-return"
    | "callable-transfer"
    | "multi-surface"
    | "declarative-binding";

export type SemanticFlowResolution =
    | "resolved"
    | "irrelevant"
    | "no-transfer"
    | "wrapper-only"
    | "need-human-check"
    | "rejected"
    | "unresolved";

export type SemanticFlowRequestKind =
    | "q_surface"
    | "q_role"
    | "q_endpoint"
    | "q_effect"
    | "q_relation"
    | "q_evidence";

export interface SemanticFlowArkMainSelector {
    methodName: string;
    parameterTypes: string[];
    returnType?: string;
    className?: string;
    superClassName?: string;
    requireOverride?: boolean;
}

export type SemanticFlowDraftId = string;
export type SemanticFlowDeficitId = string;
export type SemanticFlowDeltaId = string;

export type SemanticFlowBudgetClass =
    | "micro"
    | "body_local"
    | "owner_local"
    | "import_local";

export type SemanticFlowAssetDraft = Partial<AssetDocumentBase>;

export interface SemanticFlowAnchor {
    id: string;
    owner?: string;
    surface: string;
    method?: import("../../../arkanalyzer/out/src/core/model/ArkMethod").ArkMethod;
    methodSignature?: string;
    filePath?: string;
    line?: number;
    importSource?: string;
    stringLiterals?: string[];
    callbackProperties?: string[];
    callbackArgIndexes?: number[];
    typeHint?: string;
    metaTags?: string[];
    arkMainSelector?: SemanticFlowArkMainSelector;
}

export interface SemanticFlowSliceCodeSnippet {
    label: string;
    code: string;
}

export interface SemanticFlowSlicePackage {
    anchorId: string;
    round: number;
    template: SemanticFlowSliceTemplate;
    observations: string[];
    snippets: SemanticFlowSliceCodeSnippet[];
    companions?: string[];
    notes?: string[];
}

export interface SemanticFlowExpansionRequest {
    kind: SemanticFlowRequestKind;
    why: string[];
    ask: string;
    focus?: {
        surfaceId?: string;
        role?: string;
        endpoint?: string;
        relation?: string;
    };
    scope?: {
        owner?: string;
        importSource?: string;
        locality?: "method" | "owner" | "import" | "file";
        sharedSymbols?: string[];
        surface?: string;
    };
    budgetClass?: SemanticFlowBudgetClass;
}

export interface SemanticFlowDeficit extends SemanticFlowExpansionRequest {
    id: SemanticFlowDeficitId;
    scope: NonNullable<SemanticFlowExpansionRequest["scope"]>;
    budgetClass: SemanticFlowBudgetClass;
}

export interface SemanticFlowExpandPlan {
    kind: SemanticFlowRequestKind;
    seed: {
        mode: "anchor" | "owner" | "import";
        value: string;
    };
    edges: string[];
    budgetClass: SemanticFlowBudgetClass;
    stopCondition: string;
}

export interface SemanticFlowDelta {
    id: SemanticFlowDeltaId;
    newObservations: string[];
    newSnippets: SemanticFlowSliceCodeSnippet[];
    newCompanions: string[];
    effective: boolean;
}

export interface SemanticFlowMarker {
    draftId: SemanticFlowDraftId;
    deficitId: SemanticFlowDeficitId;
    deltaId: SemanticFlowDeltaId;
    kind: SemanticFlowRequestKind;
    focus?: SemanticFlowExpansionRequest["focus"];
    scope: SemanticFlowDeficit["scope"];
    budgetClass: SemanticFlowBudgetClass;
}

export interface SemanticFlowDoneDecision {
    status: "done";
    asset: AssetDocumentBase;
    rationale?: string[];
}

export interface SemanticFlowNeedMoreEvidenceDecision {
    status: "need-more-evidence";
    draft?: SemanticFlowAssetDraft;
    request: SemanticFlowExpansionRequest;
}

export interface SemanticFlowRejectDecision {
    status: "reject";
    reason: string;
}

export type SemanticFlowDecision =
    | SemanticFlowDoneDecision
    | SemanticFlowNeedMoreEvidenceDecision
    | SemanticFlowRejectDecision;

export interface SemanticFlowRoundRecord {
    round: number;
    draftId: SemanticFlowDraftId;
    slice: SemanticFlowSlicePackage;
    draft?: SemanticFlowAssetDraft;
    deficit?: SemanticFlowDeficit;
    plan?: SemanticFlowExpandPlan;
    delta?: SemanticFlowDelta;
    marker?: SemanticFlowMarker;
    decision?: SemanticFlowDecision;
    error?: string;
}

export interface SemanticFlowArtifact {
    kind: "asset";
    asset: AssetDocumentBase;
}

export interface SemanticFlowItemResult {
    anchor: SemanticFlowAnchor;
    draftId: SemanticFlowDraftId;
    plane?: AssetPlane;
    resolution: SemanticFlowResolution;
    asset?: AssetDocumentBase;
    draft?: SemanticFlowAssetDraft;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
    finalSlice: SemanticFlowSlicePackage;
    history: SemanticFlowRoundRecord[];
    error?: string;
}

export interface SemanticFlowRunResult {
    items: SemanticFlowItemResult[];
}

export interface SemanticFlowAnalysisAugment {
    assets: AssetDocumentBase[];
    ruleSet: TaintRuleSet;
}

export interface SemanticFlowEngineAugment {
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    sanitizerRules: SanitizerRule[];
    transferRules: TaintRuleSet["transfers"];
}

export interface SemanticFlowSessionResult {
    run: SemanticFlowRunResult;
    augment: SemanticFlowAnalysisAugment;
    engineAugment: SemanticFlowEngineAugment;
}

export interface SemanticFlowDecisionInput {
    anchor: SemanticFlowAnchor;
    draftId: SemanticFlowDraftId;
    slice: SemanticFlowSlicePackage;
    draft?: SemanticFlowAssetDraft;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
    round: number;
    history: SemanticFlowRoundRecord[];
}

export interface SemanticFlowDecider {
    decide(input: SemanticFlowDecisionInput): Promise<SemanticFlowDecision>;
}

export interface SemanticFlowExpandInput {
    anchor: SemanticFlowAnchor;
    draftId: SemanticFlowDraftId;
    slice: SemanticFlowSlicePackage;
    draft?: SemanticFlowAssetDraft;
    round: number;
    deficit: SemanticFlowDeficit;
    plan: SemanticFlowExpandPlan;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
    history: SemanticFlowRoundRecord[];
}

export interface SemanticFlowExpandResult {
    slice: SemanticFlowSlicePackage;
    delta: SemanticFlowDelta;
}

export interface SemanticFlowExpander {
    expand(input: SemanticFlowExpandInput): Promise<SemanticFlowExpandResult>;
}
