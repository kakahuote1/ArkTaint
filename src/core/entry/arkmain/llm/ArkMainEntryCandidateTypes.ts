import type {
    ArkMainEntryFact,
} from "../ArkMainTypes";

export interface ArkMainEntryCandidate {
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
}
