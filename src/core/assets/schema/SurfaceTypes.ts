import type { Confidence, SourceLocation } from "./CommonTypes";
import type { AssetEndpoint, CallbackLocator } from "./EndpointTypes";

export type AssetSurface =
    | InvokeSurface
    | ConstructSurface
    | AccessSurface
    | EntrySurface
    | CallbackSurface
    | DecoratorSurface;

export type AssetIdentity =
    | InvokeIdentity
    | ConstructIdentity
    | AccessIdentity
    | EntryIdentity
    | CallbackIdentity
    | DecoratorIdentity;

export type InvokeKind = "instance" | "static" | "namespace" | "free-function";

export interface InvokeSurface {
    surfaceId: string;
    kind: "invoke";
    modulePath: string;
    ownerName?: string;
    functionName?: string;
    methodName?: string;
    invokeKind: InvokeKind;
    argCount: number;
    parameterTypes?: string[];
    signatureId?: string;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface ConstructSurface {
    surfaceId: string;
    kind: "construct";
    modulePath: string;
    className: string;
    argCount: number;
    parameterTypes?: string[];
    signatureId?: string;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface AccessSurface {
    surfaceId: string;
    kind: "access";
    modulePath: string;
    ownerName: string;
    propertyName: string;
    accessKind: "read" | "write" | "getter" | "setter";
    receiverKind: "instance" | "static" | "namespace";
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface EntrySurface {
    surfaceId: string;
    kind: "entry";
    ownerKind: "ability" | "extension" | "component" | "page" | "service" | "callback";
    ownerName: string;
    methodName: string;
    phase: string;
    entryKind: string;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface CallbackSurface {
    surfaceId: string;
    kind: "callback";
    registrar: InvokeSurface;
    callback: CallbackLocator;
    callbackRole?: string;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface DecoratorSurface {
    surfaceId: string;
    kind: "decorator";
    decoratorName: string;
    ownerKind: "class" | "field" | "method" | "component";
    ownerName: string;
    fieldName?: string;
    argCount?: number;
    confidence: Confidence;
    provenance: SurfaceProvenance;
}

export interface SurfaceProvenance {
    source: "analyzer" | "sdk" | "manual" | "llm-proposal";
    location?: SourceLocation;
    importPath?: string;
    typeSignature?: string;
}

export interface InvokeIdentity {
    kind: "invoke";
    modulePath: string;
    ownerName?: string;
    functionName?: string;
    methodName?: string;
    invokeKind: InvokeKind;
    argCount: number;
    parameterTypes?: string[];
    signatureId?: string;
}

export interface ConstructIdentity {
    kind: "construct";
    modulePath: string;
    className: string;
    argCount: number;
    parameterTypes?: string[];
    signatureId?: string;
}

export interface AccessIdentity {
    kind: "access";
    modulePath: string;
    ownerName: string;
    propertyName: string;
    accessKind: "read" | "write" | "getter" | "setter";
    receiverKind: "instance" | "static" | "namespace";
}

export interface EntryIdentity {
    kind: "entry";
    ownerKind: "ability" | "extension" | "component" | "page" | "service" | "callback";
    ownerName: string;
    methodName: string;
    phase: string;
    entryKind: string;
}

export interface CallbackIdentity {
    kind: "callback";
    registrar: InvokeIdentity;
    callback: CallbackLocator;
    callbackRole?: string;
}

export interface DecoratorIdentity {
    kind: "decorator";
    decoratorName: string;
    ownerKind: "class" | "field" | "method" | "component";
    ownerName: string;
    fieldName?: string;
    argCount?: number;
}

export interface ResolvedEndpoint {
    endpoint: AssetEndpoint;
    valueRef?: string;
    status: "resolved" | "partial" | "unresolved";
}
