import type { AssetPlane, Confidence } from "./CommonTypes";
import type { AssetEndpoint, AssetGuard } from "./EndpointTypes";

export type AssetRole =
    | "source"
    | "sink"
    | "sanitizer"
    | "transfer"
    | "handoff"
    | "module"
    | "arkmain"
    | "entry"
    | "callback-registration";

export interface AssetBinding {
    bindingId: string;
    surfaceId: string;
    canonicalApiId?: string;
    assetId: string;
    plane: AssetPlane;
    role: AssetRole;
    endpoint?: AssetEndpoint;
    guard?: AssetGuard;
    effectTemplateRefs?: string[];
    relationRefs?: string[];
    semanticsFamily?: string;
    metadata?: AssetBindingMetadata;
    completeness: "complete" | "partial" | "unknown";
    confidence: Confidence;
}

export interface AssetBindingMetadata {
    enabled?: boolean;
    description?: string;
    tags?: string[];
    category?: string;
    severity?: "low" | "medium" | "high" | "critical";
    family?: string;
}
