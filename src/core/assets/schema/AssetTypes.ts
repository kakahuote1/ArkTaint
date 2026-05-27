import type { AssetBinding } from "./BindingTypes";
import type { AssetPlane, AssetStatus, SourceLocation } from "./CommonTypes";
import type { SemanticEffectTemplate } from "./EffectTemplateTypes";
import type { AssetRelation } from "./RelationTypes";
import type { AssetSurface } from "./SurfaceTypes";

export interface AssetDocumentBase {
    id: string;
    plane: AssetPlane;
    status: AssetStatus;
    surfaces: AssetSurface[];
    bindings: AssetBinding[];
    effectTemplates?: SemanticEffectTemplate[];
    relations?: AssetRelation[];
    provenance: AssetProvenance;
}

export interface SemanticModelAsset extends AssetDocumentBase {
    effectTemplates: SemanticEffectTemplate[];
}

export interface AssetProvenance {
    source: "builtin" | "sdk" | "manual" | "llm" | "project" | "facade-folding";
    projectId?: string;
    sdkVersion?: string;
    createdAt?: string;
    createdBy?: string;
    reviewedBy?: string;
    evidenceLocations?: SourceLocation[];
}
