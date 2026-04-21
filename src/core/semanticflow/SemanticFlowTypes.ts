import type {
    ArkMainFactKind,
    ArkMainOwnerKind,
    ArkMainPhaseName,
} from "../entry/arkmain/ArkMainTypes";
import type { ArkMainSpec, ArkMainSelector } from "../entry/arkmain/ArkMainSpec";
import type {
    ModuleConstraint,
    ModuleDispatchPreset,
    ModuleFieldPathSpec,
    ModuleSemanticSurfaceRef,
    ModuleSpec,
} from "../kernel/contracts/ModuleSpec";
import type {
    SanitizerRule,
    SinkRule,
    SourceRuleKind,
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

export type SemanticFlowArtifactClass = "arkmain" | "rule" | "module";

export type SemanticFlowResolution =
    | "resolved"
    | "irrelevant"
    | "no-transfer"
    | "wrapper-only"
    | "need-human-check"
    | "rejected"
    | "unresolved";

export type SemanticFlowConfidence = "low" | "medium" | "high";

export type SemanticFlowRequestKind =
    | "q_ret"
    | "q_recv"
    | "q_cb"
    | "q_comp"
    | "q_meta"
    | "q_wrap";

export type SemanticFlowDraftId = string;
export type SemanticFlowDeficitId = string;
export type SemanticFlowDeltaId = string;

export type SemanticFlowBudgetClass =
    | "micro"
    | "body_local"
    | "owner_local"
    | "import_local";

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
    metaTags?: string[];
    arkMainSelector?: ArkMainSelector;
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

export interface SemanticFlowDeficitFocus {
    from?: SemanticFlowSurfaceSlotRef;
    to?: SemanticFlowSurfaceSlotRef;
    companion?: string;
    carrierHint?: string;
    triggerHint?: string;
}

export interface SemanticFlowDeficitScope {
    owner?: string;
    importSource?: string;
    locality?: "method" | "owner" | "import" | "file";
    sharedSymbols?: string[];
    surface?: string;
}

export interface SemanticFlowExpansionRequest {
    kind: SemanticFlowRequestKind;
    focus: SemanticFlowDeficitFocus;
    scope: SemanticFlowDeficitScope;
    budgetClass?: SemanticFlowBudgetClass;
    why: string[];
    ask: string;
}

export interface SemanticFlowDeficit extends SemanticFlowExpansionRequest {
    id: SemanticFlowDeficitId;
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

export interface SemanticFlowSurfaceSlotRef {
    surface?: ModuleSemanticSurfaceRef | string;
    slot:
        | "arg"
        | "base"
        | "result"
        | "callback_param"
        | "method_this"
        | "method_param"
        | "field_load"
        | "decorated_field_value";
    index?: number;
    callbackArgIndex?: number;
    paramIndex?: number;
    fieldName?: string;
    fieldPath?: ModuleFieldPathSpec;
}

export interface SemanticFlowTransfer {
    from: SemanticFlowSurfaceSlotRef;
    to: SemanticFlowSurfaceSlotRef;
    relation?: "direct" | "companion" | "state" | "deferred" | "binding";
    companionSurface?: string;
}

export interface SemanticFlowDispatchHint {
    preset: ModuleDispatchPreset;
    via?: SemanticFlowSurfaceSlotRef;
    reason?: string;
}

export interface SemanticFlowEntryPattern {
    phase: ArkMainPhaseName;
    kind: Extract<ArkMainFactKind,
        "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle" | "callback"
    >;
    ownerKind?: ArkMainOwnerKind;
    schedule?: boolean;
    reason?: string;
    entryFamily?: string;
    entryShape?: string;
}

export interface SemanticFlowRelations {
    companions?: string[];
    carrier?: {
        kind: "state" | "pair" | "bridge" | "deferred" | "declarative" | string;
        label?: string;
    };
    trigger?: SemanticFlowDispatchHint;
    constraints?: ModuleConstraint[];
    entryPattern?: SemanticFlowEntryPattern;
}

export type SemanticFlowRuleKind = "source" | "sink" | "sanitizer" | "transfer";
export type SemanticFlowModuleKind = "state" | "pair" | "bridge" | "deferred" | "declarative";

export interface SemanticFlowSummary {
    inputs: SemanticFlowSurfaceSlotRef[];
    outputs: SemanticFlowSurfaceSlotRef[];
    transfers: SemanticFlowTransfer[];
    relations?: SemanticFlowRelations;
    confidence: SemanticFlowConfidence;
    ruleKind?: SemanticFlowRuleKind;
    sourceKind?: SourceRuleKind;
    moduleKind?: SemanticFlowModuleKind;
    moduleSpec?: ModuleSpec;
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
    focus: SemanticFlowDeficitFocus;
    scope: SemanticFlowDeficitScope;
    budgetClass: SemanticFlowBudgetClass;
}

export interface SemanticFlowDoneDecision {
    status: "done";
    summary: SemanticFlowSummary;
    resolution: Exclude<SemanticFlowResolution, "rejected" | "unresolved">;
    classification?: SemanticFlowArtifactClass;
    rationale?: string[];
}

export interface SemanticFlowNeedMoreEvidenceDecision {
    status: "need-more-evidence";
    draft: SemanticFlowSummary;
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
    draft?: SemanticFlowSummary;
    deficit?: SemanticFlowDeficit;
    plan?: SemanticFlowExpandPlan;
    delta?: SemanticFlowDelta;
    marker?: SemanticFlowMarker;
    decision?: SemanticFlowDecision;
    error?: string;
}

export interface SemanticFlowArkMainArtifact {
    kind: "arkmain";
    spec: ArkMainSpec;
}

export interface SemanticFlowRuleArtifact {
    kind: "rule";
    ruleSet: TaintRuleSet;
}

export interface SemanticFlowModuleArtifact {
    kind: "module";
    moduleSpec: ModuleSpec;
}

export type SemanticFlowArtifact =
    | SemanticFlowArkMainArtifact
    | SemanticFlowRuleArtifact
    | SemanticFlowModuleArtifact;

export interface SemanticFlowItemResult {
    anchor: SemanticFlowAnchor;
    draftId: SemanticFlowDraftId;
    classification?: SemanticFlowArtifactClass;
    resolution: SemanticFlowResolution;
    summary?: SemanticFlowSummary;
    draft?: SemanticFlowSummary;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
    artifact?: SemanticFlowArtifact;
    finalSlice: SemanticFlowSlicePackage;
    history: SemanticFlowRoundRecord[];
    error?: string;
}

export interface SemanticFlowRunResult {
    items: SemanticFlowItemResult[];
}

export interface SemanticFlowAnalysisAugment {
    ruleSet: TaintRuleSet;
    moduleSpecs: ModuleSpec[];
    arkMainSpecs: ArkMainSpec[];
}

export interface SemanticFlowEngineAugment {
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    sanitizerRules: SanitizerRule[];
    transferRules: TaintRuleSet["transfers"];
    moduleSpecs: ModuleSpec[];
    arkMainSpecs: ArkMainSpec[];
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
    draft?: SemanticFlowSummary;
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
    draft?: SemanticFlowSummary;
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

