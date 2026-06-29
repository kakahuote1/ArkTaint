import type { Confidence, SourceLocation } from "./CommonTypes";
import type { AssetEndpoint, AssetGuard } from "./EndpointTypes";

export type AssetRelation = FacadeRelation;

export interface FacadeRelation {
    relationId: string;
    kind: "facade";
    fromSurfaceId: string;
    target: {
        assetId?: string;
        surfaceId?: string;
        canonicalApiId?: string;
    };
    evidence: "transparent-wrapper" | "delegating-wrapper";
    evidenceLocation: SourceLocation;
    argumentMap?: EndpointMap[];
    returnMap?: EndpointMap[];
    callbackMap?: EndpointMap[];
    constraints?: AssetGuard;
    confidence: Confidence;
}

export interface EndpointMap {
    from: AssetEndpoint;
    to: AssetEndpoint;
}
