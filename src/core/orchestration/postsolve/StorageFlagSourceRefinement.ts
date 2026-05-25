import { ArkInstanceInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import { collectCandidateReadSites } from "./SafeOverwriteRefinement";
import { methodSignatureTextFromStmt, normalizeQuotedLiteral } from "./PostsolveRuleUtils";

const SENSITIVE_KEY_PATTERN = /(token|password|passwd|pwd|secret|credential|auth|authorization|cookie|session|apikey|api_key|privatekey|private_key|phone|email|idcard|identity|cardno|bankcard)/i;
const STATE_FLAG_KEY_PATTERN = /(is|has|show|hide|enable|enabled|allow|allowed|first|privacy|jump|flag|state|status|theme|mode|layout|tab|selected|visible|open|closed|index|count)/i;

export function evaluateStorageFlagSourcePath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    if (!isGenericStorageReadSource(flow.source)) return [];
    const readSites = collectCandidateReadSites(path, context);
    for (const site of readSites) {
        const evidence = buildBooleanFlagReadEvidence(flow, site.stmt, site.readExpr, site.factId);
        if (evidence) return [evidence];
    }
    return [];
}

function buildBooleanFlagReadEvidence(
    flow: TaintFlow,
    stmt: any,
    readExpr: any,
    factId?: string,
): PostsolveEvidence | undefined {
    if (!(readExpr instanceof ArkInstanceInvokeExpr)) return undefined;
    const methodName = readExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "get" && methodName !== "getSync") return undefined;
    if (!isPreferencesRead(readExpr)) return undefined;

    const args = readExpr.getArgs?.() || [];
    if (args.length < 2 || !isBooleanLiteral(args[1])) return undefined;
    const keyLabel = resolveKeyLabel(stmt, args[0]);
    if (keyLabel && SENSITIVE_KEY_PATTERN.test(keyLabel)) return undefined;
    if (keyLabel && !STATE_FLAG_KEY_PATTERN.test(keyLabel)) return undefined;

    return {
        kind: "storage_flag_source",
        polarity: "negative",
        strength: "strong",
        stability: "overridable",
        position: {
            factId,
            stmtText: stmt?.toString?.() || "",
            methodSignature: methodSignatureTextFromStmt(stmt),
        },
        target: {
            sinkFactId: flow.sinkFactId || "",
            sinkNodeId: flow.sinkNodeId,
        },
        meta: {
            reason: "non_sensitive_boolean_storage_flag_source",
            source: flow.source,
            keyLabel: keyLabel || "",
            readStmtText: stmt?.toString?.() || "",
        },
    };
}

function isGenericStorageReadSource(source: string): boolean {
    const text = String(source || "");
    return text.includes("source.harmony.preferences.get")
        || text.includes("source.harmony.globalcontext.getObject");
}

function isPreferencesRead(readExpr: ArkInstanceInvokeExpr): boolean {
    const sig = String(readExpr.getMethodSignature?.()?.toString?.() || "").toLowerCase();
    const baseType = String(readExpr.getBase?.()?.getType?.()?.toString?.() || "").toLowerCase();
    return sig.includes("preferences")
        || sig.includes("datapreferences")
        || baseType.includes("preferences")
        || baseType.includes("datapreferences");
}

function isBooleanLiteral(value: any): boolean {
    const text = String(value?.toString?.() || "").trim().toLowerCase();
    return text === "true" || text === "false" || text === "0" || text === "1";
}

function resolveKeyLabel(stmt: any, value: any): string | undefined {
    const literal = normalizeQuotedLiteral(String(value?.toString?.() || ""));
    if (literal !== undefined) return literal;
    if (!(value instanceof Local)) return undefined;
    const method = stmt?.getCfg?.()?.getDeclaringMethod?.();
    const stmts: any[] = method?.getCfg?.()?.getStmts?.() || [];
    const readIndex = stmts.indexOf(stmt);
    if (readIndex < 0) return undefined;
    const localName = value.getName?.() || "";
    for (let i = readIndex - 1; i >= 0; i--) {
        const candidate = stmts[i];
        if (!(candidate instanceof ArkAssignStmt)) continue;
        const left = candidate.getLeftOp?.();
        if (!(left instanceof Local) || left.getName?.() !== localName) continue;
        return normalizeStorageKeyText(candidate.getRightOp?.());
    }
    return undefined;
}

function normalizeStorageKeyText(value: any): string | undefined {
    const raw = String(value?.toString?.() || "").trim();
    const literal = normalizeQuotedLiteral(raw);
    if (literal !== undefined) return literal;
    const staticField = raw.match(/\[static\]([A-Za-z0-9_.$-]+)/);
    if (staticField) return staticField[1];
    const staticConstant = raw.match(/\.\s*([A-Z][A-Z0-9_]+)\s*>?$/);
    if (staticConstant) return staticConstant[1];
    return raw || undefined;
}
