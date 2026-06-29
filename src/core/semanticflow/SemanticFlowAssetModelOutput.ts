import type { AssetDocumentBase } from "../assets/schema";
import { validateAssetDocument } from "../assets/schema";

export type SemanticFlowAssetModelOutput =
    | SemanticFlowAssetModelDone
    | SemanticFlowAssetModelNeedMoreEvidence
    | SemanticFlowAssetModelReject;

export interface SemanticFlowAssetModelDone {
    status: "done";
    asset: AssetDocumentBase;
    rationale?: string[];
}

export interface SemanticFlowAssetModelNeedMoreEvidence {
    status: "need-more-evidence";
    draft?: Partial<AssetDocumentBase>;
    request: {
        kind: "q_surface" | "q_role" | "q_endpoint" | "q_effect" | "q_relation" | "q_evidence";
        why: string[];
        ask: string;
    };
}

export interface SemanticFlowAssetModelReject {
    status: "reject";
    reason: string;
}

export interface ParseSemanticFlowAssetModelOutputOptions {
    analyzerBackedSurfaceIds?: Set<string>;
}

const legacyOutputKeys = new Set([
    "classification",
    "resolution",
    "summary",
    "moduleSpec",
    "ruleSet",
    "arkMainSpec",
]);

export function parseSemanticFlowAssetModelOutput(
    raw: string,
    options: ParseSemanticFlowAssetModelOutputOptions = {},
): SemanticFlowAssetModelOutput {
    const parsed = parseJsonObject(raw);
    rejectLegacyOutputKeys(parsed, "$");
    if (!isObject(parsed)) {
        throw new Error("semanticflow asset model output must be an object");
    }
    if (parsed.status === "done") {
        if (!isObject(parsed.asset)) {
            throw new Error("done output requires asset object");
        }
        const validation = validateAssetDocument(parsed.asset);
        if (!validation.valid) {
            throw new Error(`asset output invalid: ${validation.errors.join("; ")}`);
        }
        const asset = parsed.asset as unknown as AssetDocumentBase;
        validateLlmAssetPromotion(asset, options);
        return {
            status: "done",
            asset,
            rationale: Array.isArray(parsed.rationale) ? parsed.rationale.map(String) : undefined,
        };
    }
    if (parsed.status === "need-more-evidence") {
        if (!isObject(parsed.request)) {
            throw new Error("need-more-evidence output requires request object");
        }
        const request = parsed.request as Record<string, unknown>;
        if (typeof request.kind !== "string" || !["q_surface", "q_role", "q_endpoint", "q_effect", "q_relation", "q_evidence"].includes(request.kind)) {
            throw new Error("need-more-evidence request.kind invalid");
        }
        if (!Array.isArray(request.why) || request.why.length === 0) {
            throw new Error("need-more-evidence request.why must be a non-empty array");
        }
        if (typeof request.ask !== "string" || !request.ask.trim()) {
            throw new Error("need-more-evidence request.ask must be a non-empty string");
        }
        return {
            status: "need-more-evidence",
            draft: isObject(parsed.draft) ? parsed.draft as Partial<AssetDocumentBase> : undefined,
            request: {
                kind: request.kind as SemanticFlowAssetModelNeedMoreEvidence["request"]["kind"],
                why: request.why.map(String),
                ask: request.ask,
            },
        };
    }
    if (parsed.status === "reject") {
        if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
            throw new Error("reject output requires reason");
        }
        return { status: "reject", reason: parsed.reason };
    }
    throw new Error("semanticflow asset model output status invalid");
}

function validateLlmAssetPromotion(
    asset: AssetDocumentBase,
    options: ParseSemanticFlowAssetModelOutputOptions,
): void {
    if (asset.provenance.source === "llm" && asset.status !== "candidate" && asset.status !== "llm-generated") {
        throw new Error("LLM output cannot publish schema-valid/reviewed/replayed/official assets");
    }
    if (asset.status === "schema-valid" || asset.status === "reviewed" || asset.status === "replayed" || asset.status === "official") {
        const backed = options.analyzerBackedSurfaceIds || new Set<string>();
        for (const surface of asset.surfaces) {
            if (!backed.has(surface.surfaceId)) {
                throw new Error(`surface ${surface.surfaceId} is not analyzer-backed`);
            }
        }
    }
}

function parseJsonObject(raw: string): unknown {
    try {
        return JSON.parse(stripJsonFences(raw));
    } catch (error) {
        throw new Error(`semanticflow asset model output is not valid JSON: ${String((error as any)?.message || error)}`);
    }
}

function stripJsonFences(raw: string): string {
    const text = String(raw || "").trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    return fence ? fence[1].trim() : text;
}

function rejectLegacyOutputKeys(value: unknown, path: string): void {
    if (!isObject(value)) {
        if (Array.isArray(value)) {
            value.forEach((item, index) => rejectLegacyOutputKeys(item, `${path}[${index}]`));
        }
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (legacyOutputKeys.has(key)) {
            throw new Error(`${path}.${key} is a legacy semanticflow output field`);
        }
        rejectLegacyOutputKeys(child, `${path}.${key}`);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
