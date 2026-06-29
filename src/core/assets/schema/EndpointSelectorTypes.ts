import type { AssetEndpoint } from "./EndpointTypes";

export interface EndpointSelectorRef {
    endpoint: AssetEndpoint;
    pathFrom?: AssetEndpoint;
    slotKind?: string;
    slotWriteMode?: "replace" | "append";
    taintScope?: "self" | "contained-values";
}
