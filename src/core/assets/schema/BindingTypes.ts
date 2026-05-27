import type { AssetPlane, Confidence } from "./CommonTypes";
import type { AssetEndpoint, AssetGuard } from "./EndpointTypes";
import type { RuntimeSelector } from "./SelectorTypes";

export type AssetRole =
    | "source"
    | "sink"
    | "sanitizer"
    | "transfer"
    | "handoff"
    | "entry"
    | "callback-registration";

export interface AssetBinding {
    bindingId: string;
    surfaceId: string;
    assetId: string;
    plane: AssetPlane;
    role: AssetRole;
    selector?: RuntimeSelector;
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
    layer?: "kernel" | "project";
    family?: string;
    tier?: "A" | "B" | "C";
}
