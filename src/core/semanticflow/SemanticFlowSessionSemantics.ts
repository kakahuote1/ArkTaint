import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const ITEM_CACHE_SEMANTIC_MODULE_IDS = [
    "./SemanticFlowArtifacts",
    "./SemanticFlowExpanders",
    "./SemanticFlowIncremental",
    "./SemanticFlowLlm",
    "./SemanticFlowPipeline",
    "./SemanticFlowPrompt",
    "./SemanticFlowSessionCache",
] as const;

let cachedSemanticFlowItemCacheSemanticsFingerprint: string | undefined;

export function getSemanticFlowItemCacheSemanticsFingerprint(): string {
    if (cachedSemanticFlowItemCacheSemanticsFingerprint) {
        return cachedSemanticFlowItemCacheSemanticsFingerprint;
    }
    const moduleFingerprints = ITEM_CACHE_SEMANTIC_MODULE_IDS.map(moduleId => {
        const modulePath = require.resolve(moduleId);
        return {
            moduleId,
            fileName: path.basename(modulePath),
            sha256: sha256Hex(fs.readFileSync(modulePath)),
        };
    });
    cachedSemanticFlowItemCacheSemanticsFingerprint = sha256Hex(JSON.stringify(moduleFingerprints));
    return cachedSemanticFlowItemCacheSemanticsFingerprint;
}

function sha256Hex(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}
