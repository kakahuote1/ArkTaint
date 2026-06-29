import type { Confidence, SourceLocation } from "./CommonTypes";
import type { AssetEndpoint, CallbackLocator } from "./EndpointTypes";

export type AssetSurface =
    | InvokeSurface
    | ConstructSurface
    | AccessSurface
    | EntrySurface
    | CallbackSurface
    | DecoratorSurface;

export type InvokeKind = "instance" | "static" | "namespace" | "free-function";

export type IdentityBackedSurfaceKind = AssetSurface["kind"];

export interface IdentityBackedSurfaceBase {
    surfaceId: string;
    canonicalApiId?: string;
    evidence?: AssetSurfaceEvidence;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface AssetSurfaceEvidence {
    arkanalyzer?: AssetArkanalyzerEvidence;
}

export interface AssetArkanalyzerEvidence {
    methodKey?: {
        declaringFileName: string;
        declaringNamespacePath?: string[];
        declaringClassName: string;
        methodName: string;
        parameterTypes: string[];
        returnType: string;
        staticFlag: boolean;
    };
}

export interface InvokeSurface extends IdentityBackedSurfaceBase {
    kind: "invoke";
}

export interface ConstructSurface extends IdentityBackedSurfaceBase {
    kind: "construct";
}

export interface AccessSurface extends IdentityBackedSurfaceBase {
    kind: "access";
}

export interface EntrySurface extends IdentityBackedSurfaceBase {
    kind: "entry";
}

export interface CallbackSurface extends IdentityBackedSurfaceBase {
    kind: "callback";
    registrar?: {
        surfaceId: string;
        canonicalApiId: string;
    };
    callback: CallbackLocator;
    callbackRole?: string;
}

export interface DecoratorSurface extends IdentityBackedSurfaceBase {
    kind: "decorator";
}

export interface SurfaceProvenance {
    source: "analyzer" | "sdk" | "manual" | "llm-proposal";
    location?: SourceLocation;
    importPath?: string;
    typeSignature?: string;
}

export interface ResolvedEndpoint {
    endpoint: AssetEndpoint;
    valueRef?: string;
    status: "resolved" | "partial" | "unresolved";
}
