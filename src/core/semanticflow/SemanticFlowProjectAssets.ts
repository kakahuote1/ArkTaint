import * as fs from "fs";
import * as path from "path";
import type { ArkMainSpecDocument } from "../entry/arkmain/ArkMainSpec";
import type { ModuleSpecDocument } from "../kernel/contracts/ModuleSpec";
import type { TaintRuleSet } from "../rules/RuleSchema";

export interface PublishSemanticFlowProjectAssetsOptions {
    projectId: string;
    modelRoot?: string;
    ruleSet: TaintRuleSet;
    moduleDocument: ModuleSpecDocument;
    arkMainDocument: ArkMainSpecDocument;
}

export interface PublishSemanticFlowProjectAssetsResult {
    rulePath?: string;
    moduleSpecPath?: string;
    arkMainSpecPath?: string;
}

export function publishSemanticFlowProjectAssets(
    options: PublishSemanticFlowProjectAssetsOptions,
): PublishSemanticFlowProjectAssetsResult {
    const projectId = sanitizeProjectId(options.projectId);
    if (!projectId) {
        throw new Error("publish model project id must not be empty");
    }
    const modelRoot = resolveModelRoot(options.modelRoot);

    const result: PublishSemanticFlowProjectAssetsResult = {};
    result.rulePath = writeJsonDocument(
        path.join(modelRoot, "project", projectId, "rules", "semanticflow.rules.json"),
        hasAnyRule(options.ruleSet)
            ? options.ruleSet
            : undefined,
    );
    result.moduleSpecPath = writeJsonDocument(
        path.join(modelRoot, "project", projectId, "modules", "semanticflow.modules.json"),
        options.moduleDocument.modules && options.moduleDocument.modules.length > 0
            ? options.moduleDocument
            : undefined,
    );
    result.arkMainSpecPath = writeJsonDocument(
        path.join(modelRoot, "project", projectId, "arkmain", "semanticflow.arkmain.json"),
        options.arkMainDocument.entries && options.arkMainDocument.entries.length > 0
            ? options.arkMainDocument
            : undefined,
    );
    return result;
}

function writeJsonDocument(targetPath: string, document: unknown): string | undefined {
    const resolved = path.resolve(targetPath);
    if (!document) {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            fs.unlinkSync(resolved);
        }
        return undefined;
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(document, null, 2), "utf-8");
    return resolved;
}

function resolveModelRoot(explicitPath?: string): string {
    if (explicitPath) {
        return path.resolve(explicitPath);
    }
    return path.resolve(__dirname, "../../../../src/models");
}

function hasAnyRule(ruleSet: TaintRuleSet): boolean {
    return (ruleSet.sources || []).length > 0
        || (ruleSet.sinks || []).length > 0
        || (ruleSet.sanitizers || []).length > 0
        || (ruleSet.transfers || []).length > 0;
}

function sanitizeProjectId(value: string): string {
    return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}
