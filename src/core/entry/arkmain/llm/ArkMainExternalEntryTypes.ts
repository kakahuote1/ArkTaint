import type { ArkMainEntryFact, ArkMainFactKind, ArkMainPhaseName } from "../ArkMainTypes";

export interface ArkMainExternalEntryCandidate {
    method: ArkMainEntryFact["method"];
    methodSignature: string;
    className: string;
    methodName: string;
    filePath?: string;
    superClassName?: string;
    parameterTypes: string[];
    returnType?: string;
    isOverride: boolean;
    ownerSignals: string[];
    overrideSignals: string[];
    frameworkSignals: string[];
    summaryText: string;
}

export interface ArkMainExternalEntryRecognition {
    methodSignature: string;
    isEntry: boolean;
    confidence: number;
    phase?: ArkMainPhaseName;
    kind?: Extract<ArkMainFactKind,
        "ability_lifecycle" | "stage_lifecycle" | "extension_lifecycle" | "page_build" | "page_lifecycle" | "callback"
    >;
    reason: string;
    evidenceTags: string[];
}

export interface ArkMainExternalEntryRecognizerOptions {
    maxCandidates?: number;
    minConfidence?: number;
    batchSize?: number;
    enableCache?: boolean;
    cachePath?: string;
    model?: string;
}
