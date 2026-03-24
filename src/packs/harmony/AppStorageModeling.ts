import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { Decorator } from "../../../arkanalyzer/out/src/core/base/Decorator";
import { StringType } from "../../../arkanalyzer/out/src/core/base/Type";
import { resolveHarmonyMethods } from "../../core/kernel/contracts/HarmonyModelingUtils";
import {
    AppStorageDynamicKeyWarning,
    AppStorageFieldEndpoint,
    AppStorageSemanticModel,
    BuildAppStorageSemanticModelArgs,
} from "../../core/kernel/contracts/AppStorageModelingProvider";

const APP_STORAGE_CLASS = "AppStorage";
const LOCAL_STORAGE_CLASS = "LocalStorage";
const PERSISTENT_STORAGE_CLASS = "PersistentStorage";
const STORAGE_API_CLASSES = new Set<string>([
    APP_STORAGE_CLASS,
    LOCAL_STORAGE_CLASS,
    PERSISTENT_STORAGE_CLASS,
]);
const DECORATOR_STORAGE_PROP = "StorageProp";
const DECORATOR_STORAGE_LINK = "StorageLink";
const DECORATOR_LOCAL_STORAGE_PROP = "LocalStorageProp";
const DECORATOR_LOCAL_STORAGE_LINK = "LocalStorageLink";
const STORAGE_DECORATOR_KINDS = new Set<string>([
    DECORATOR_STORAGE_PROP,
    DECORATOR_STORAGE_LINK,
    DECORATOR_LOCAL_STORAGE_PROP,
    DECORATOR_LOCAL_STORAGE_LINK,
]);

export type AppStorageModel = AppStorageSemanticModel;
export type BuildAppStorageModelArgs = BuildAppStorageSemanticModelArgs;

interface DecoratedStorageFieldInfo {
    key: string;
    fieldName: string;
    fieldSignature: string;
    decoratorKind: string;
}

interface StorageKeyToken {
    keys: string[];
    dynamic: boolean;
    keyExprText: string;
}

export function buildAppStorageModel(args: BuildAppStorageModelArgs): AppStorageModel {
    const writeNodeIdsByKey = new Map<string, Set<number>>();
    const writeFieldNodeIdsByKey = new Map<string, Set<number>>();
    const writeFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readNodeIdsByKey = new Map<string, Set<number>>();
    const readFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readFieldNodeIdsByKey = new Map<string, Set<number>>();
    const warningByKey = new Map<string, AppStorageDynamicKeyWarning>();

    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    const decoratedFieldsBySignature = collectDecoratedStorageFieldsBySignature(args.scene);
    const fieldEndpointByKey = new Map<string, Set<string>>();
    const writeFieldEndpointByKey = new Map<string, Set<string>>();

    const addWriteNodeId = (key: string, nodeId: number): void => {
        if (!writeNodeIdsByKey.has(key)) writeNodeIdsByKey.set(key, new Set<number>());
        writeNodeIdsByKey.get(key)!.add(nodeId);
    };
    const addReadNodeId = (key: string, nodeId: number): void => {
        if (!readNodeIdsByKey.has(key)) readNodeIdsByKey.set(key, new Set<number>());
        readNodeIdsByKey.get(key)!.add(nodeId);
    };
    const addWriteFieldNodeId = (key: string, nodeId: number): void => {
        if (!writeFieldNodeIdsByKey.has(key)) writeFieldNodeIdsByKey.set(key, new Set<number>());
        writeFieldNodeIdsByKey.get(key)!.add(nodeId);
    };
    const addWriteFieldEndpoint = (key: string, endpoint: AppStorageFieldEndpoint): void => {
        if (!writeFieldEndpointsByKey.has(key)) writeFieldEndpointsByKey.set(key, []);
        const list = writeFieldEndpointsByKey.get(key)!;
        const endpointKey = `${endpoint.objectNodeId}#${endpoint.fieldName}`;
        let dedupSet = writeFieldEndpointByKey.get(key);
        if (!dedupSet) {
            dedupSet = new Set<string>();
            writeFieldEndpointByKey.set(key, dedupSet);
        }
        if (dedupSet.has(endpointKey)) return;
        dedupSet.add(endpointKey);
        list.push(endpoint);
    };
    const addFieldEndpoint = (key: string, endpoint: AppStorageFieldEndpoint): void => {
        if (!readFieldEndpointsByKey.has(key)) readFieldEndpointsByKey.set(key, []);
        const list = readFieldEndpointsByKey.get(key)!;
        const endpointKey = `${endpoint.objectNodeId}#${endpoint.fieldName}`;
        let dedupSet = fieldEndpointByKey.get(key);
        if (!dedupSet) {
            dedupSet = new Set<string>();
            fieldEndpointByKey.set(key, dedupSet);
        }
        if (dedupSet.has(endpointKey)) return;
        dedupSet.add(endpointKey);
        list.push(endpoint);
    };
    const addFieldNodeId = (key: string, fieldNodeId: number): void => {
        if (!readFieldNodeIdsByKey.has(key)) readFieldNodeIdsByKey.set(key, new Set<number>());
        readFieldNodeIdsByKey.get(key)!.add(fieldNodeId);
    };
    const addDynamicKeyWarning = (warning: AppStorageDynamicKeyWarning): void => {
        const k = `${warning.methodSignature}|${warning.callSignature}|${warning.keyExprText}`;
        if (warningByKey.has(k)) return;
        warningByKey.set(k, warning);
    };

    for (const method of methods) {
        const ownerClassName = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (STORAGE_API_CLASSES.has(ownerClassName)) {
            continue;
        }
        const methodSignature = method.getSignature().toString();
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) {
                continue;
            }

            const methodSig = invokeExpr.getMethodSignature?.();
            const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
            if (!STORAGE_API_CLASSES.has(className)) {
                continue;
            }
            const apiName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const callSignature = methodSig?.toString?.() || "";
            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) continue;

            const keyArg = invokeArgs[0];
            const keyToken = resolveStorageKeyToken(args.scene, args.queries, methodSignature, keyArg);
            if (!keyToken) {
                addDynamicKeyWarning({
                    methodSignature,
                    callSignature,
                    apiName,
                    keyExprText: keyArg?.toString?.() || "<unknown>",
                });
                continue;
            }
            const keys = keyToken.keys;
            if (keyToken.dynamic) {
                addDynamicKeyWarning({
                    methodSignature,
                    callSignature,
                    apiName,
                    keyExprText: keyToken.keyExprText,
                });
            }

            if (
                apiName === "set"
                || apiName === "setOrCreate"
                || apiName === "persistProp"
            ) {
                if (invokeArgs.length > 1) {
                    const valueArg = invokeArgs[1];
                    const writeNodeIds = collectPagNodeIdsByValue(args.pag, valueArg);
                    for (const key of keys) {
                        for (const nodeId of writeNodeIds) {
                            addWriteNodeId(key, nodeId);
                        }
                    }
                }
            }

            if (
                apiName === "get"
                || apiName === "prop"
                || apiName === "link"
                || apiName === "setOrCreate"
            ) {
                if (stmt instanceof ArkAssignStmt) {
                    const leftOp = stmt.getLeftOp();
                    const readNodeIds = collectPagNodeIdsByValue(args.pag, leftOp);
                    for (const key of keys) {
                        for (const nodeId of readNodeIds) {
                            addReadNodeId(key, nodeId);
                        }
                    }
                }
            }
        }

        if (decoratedFieldsBySignature.size > 0) {
            for (const stmt of cfg.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp();
                const right = stmt.getRightOp();
                if (left instanceof ArkInstanceFieldRef) {
                    collectDecoratorFieldEndpoints(left, decoratedFieldsBySignature, args.pag, addFieldEndpoint, addFieldNodeId);
                    collectDecoratorFieldWriteSourceNodes(left, right, decoratedFieldsBySignature, args.pag, addWriteNodeId);
                    collectDecoratorFieldWrites(left, decoratedFieldsBySignature, args.pag, addWriteFieldNodeId, addWriteFieldEndpoint);
                }
                if (right instanceof ArkInstanceFieldRef) {
                    collectDecoratorFieldEndpoints(right, decoratedFieldsBySignature, args.pag, addFieldEndpoint, addFieldNodeId);
                }
            }
        }
    }

    return {
        writeNodeIdsByKey,
        writeFieldNodeIdsByKey,
        writeFieldEndpointsByKey,
        readNodeIdsByKey,
        readFieldEndpointsByKey,
        readFieldNodeIdsByKey,
        dynamicKeyWarnings: [...warningByKey.values()],
    };
}


function collectPagNodeIdsByValue(pag: Pag, value: any): number[] {
    const result: number[] = [];
    let nodes = pag.getNodesByValue(value);
    if ((!nodes || nodes.size === 0) && value instanceof Local) {
        try {
            pag.getOrNewNode(0, value, value.getDeclaringStmt?.() || undefined);
            nodes = pag.getNodesByValue(value);
        } catch {
            nodes = undefined;
        }
    }
    if (!nodes || nodes.size === 0) return result;
    for (const nodeId of nodes.values()) {
        result.push(nodeId);
    }
    return result;
}

function resolveStorageKeyLiteral(value: any): string | undefined {
    if (!value) return undefined;
    if (value instanceof Constant) {
        return normalizeStorageKey(value.getValue());
    }
    if (value instanceof Local) {
        const type = value.getType?.();
        if (type instanceof StringType) {
            const fromType = normalizeStorageKey((type as any).getName?.() || "");
            if (fromType && fromType.toLowerCase() !== "string") {
                return fromType;
            }
        }
    }
    const rawText = value?.toString?.() || "";
    if (/^["'`][^"'`]+["'`]$/.test(rawText.trim())) {
        return normalizeStorageKey(rawText.trim());
    }
    return undefined;
}

function resolveStorageKeyToken(
    scene: Scene,
    queries: BuildAppStorageModelArgs["queries"],
    methodSignature: string,
    value: any,
): StorageKeyToken | undefined {
    const literal = resolveStorageKeyLiteral(value);
    if (literal) {
        return {
            keys: [literal],
            dynamic: false,
            keyExprText: literal,
        };
    }
    if (value instanceof Local) {
        const tracedExpr = traceDynamicKeyExprByLocal(value);
        if (tracedExpr) {
            const tracedLiteral = normalizeStorageKey(tracedExpr);
            if (tracedLiteral) {
                return {
                    keys: [tracedLiteral],
                    dynamic: false,
                    keyExprText: tracedLiteral,
                };
            }
        }
        const sameFileCandidates = collectSameFileLocalKeyCandidates(scene, queries, methodSignature, value);
        if (sameFileCandidates.length >= 1) {
            return {
                keys: sameFileCandidates,
                dynamic: sameFileCandidates.length > 1,
                keyExprText: String(value?.toString?.() || "").trim(),
            };
        }
        const localCandidates = queries.collectFiniteStringCandidatesFromValue(scene, value);
        const normalizedCandidates = localCandidates
            .map(candidate => normalizeStorageKey(candidate))
            .filter((candidate): candidate is string => Boolean(candidate));
        const uniqueCandidates = [...new Set(normalizedCandidates)];
        if (uniqueCandidates.length >= 1) {
            return {
                keys: uniqueCandidates,
                dynamic: uniqueCandidates.length > 1,
                keyExprText: String(value?.toString?.() || "").trim(),
            };
        }
        const localName = value.getName?.() || value.toString?.() || "local";
        return {
            keys: [`__DYN_LOCAL__:${methodSignature}:${localName}`],
            dynamic: true,
            keyExprText: value.toString?.() || localName,
        };
    }
    const candidates = queries.collectFiniteStringCandidatesFromValue(scene, value);
    if (candidates.length > 0) {
        const normalizedCandidates = candidates
            .map(candidate => normalizeStorageKey(candidate))
            .filter((candidate): candidate is string => Boolean(candidate));
        const uniqueCandidates = [...new Set(normalizedCandidates)];
        if (uniqueCandidates.length >= 1) {
            return {
                keys: uniqueCandidates,
                dynamic: uniqueCandidates.length > 1,
                keyExprText: String(value?.toString?.() || "").trim(),
            };
        }
    }
    const rawText = String(value?.toString?.() || "").trim();
    if (rawText.length === 0) return undefined;
    return {
        keys: [`__DYN_EXPR__:${methodSignature}:${rawText}`],
        dynamic: true,
        keyExprText: rawText,
    };
}

function collectSameFileLocalKeyCandidates(
    scene: Scene,
    queries: BuildAppStorageModelArgs["queries"],
    methodSignature: string,
    local: Local,
): string[] {
    const declaringStmt: any = local.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt)) return [];
    const right = declaringStmt.getRightOp?.();
    if (!(right instanceof ArkStaticInvokeExpr || right instanceof ArkInstanceInvokeExpr)) return [];

    const targetMethodName = right.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (!targetMethodName) return [];
    const sourceFilePath = extractFilePathFromMethodSignature(methodSignature);
    if (!sourceFilePath) return [];

    const invokeArgs = right.getArgs ? right.getArgs() : [];
    const candidates = new Set<string>();
    for (const method of scene.getMethods()) {
        if (method.getName?.() !== targetMethodName) continue;
        if (extractFilePathFromMethodSignature(method.getSignature?.().toString?.() || "") !== sourceFilePath) {
            continue;
        }
        const booleanBindings = resolveBooleanParamBindings(queries, method, invokeArgs);
        const simpleBranchCandidates = tryResolveSimpleBooleanBranchStringCandidates(method, booleanBindings);
        if (simpleBranchCandidates.length > 0) {
            for (const candidate of simpleBranchCandidates) {
                candidates.add(candidate);
            }
            continue;
        }
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkReturnStmt)) continue;
            const retValue = stmt.getOp?.();
            if (!retValue) continue;
            const narrowed = tryResolveBooleanStorageLiteral(retValue, booleanBindings);
            if (narrowed) {
                candidates.add(narrowed);
                continue;
            }
            const literal = resolveStorageKeyLiteral(retValue);
            if (literal) {
                candidates.add(literal);
                continue;
            }
            for (const extracted of extractQuotedStorageLiterals(retValue)) {
                candidates.add(extracted);
            }
        }
    }
    return [...candidates.values()];
}

function tryResolveSimpleBooleanBranchStringCandidates(method: any, bindings: Map<string, boolean>): string[] {
    if (bindings.size === 0) return [];
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    const stmts = cfg.getStmts?.() || [];
    const ifStmtText = String(stmts.find((stmt: any) => /^if\b/.test(String(stmt?.toString?.() || "").trim()))?.toString?.() || "").trim();
    if (!ifStmtText) return [];
    const conditionText = stripOuterParens(ifStmtText.replace(/^if\s+/, "").trim());

    let evaluated: boolean | undefined;
    for (const [paramName, boolValue] of bindings.entries()) {
        evaluated = evaluateBooleanCondition(conditionText, paramName, boolValue);
        if (evaluated !== undefined) break;
    }
    if (evaluated === undefined) return [];

    const literalCandidates: string[] = [];
    const seen = new Set<string>();
    for (const stmt of stmts) {
        const rightOp = stmt instanceof ArkAssignStmt
            ? stmt.getRightOp?.()
            : stmt instanceof ArkReturnStmt
                ? stmt.getOp?.()
                : undefined;
        if (!rightOp) continue;
        for (const extracted of extractQuotedStorageLiterals(rightOp)) {
            if (seen.has(extracted)) continue;
            seen.add(extracted);
            literalCandidates.push(extracted);
            if (literalCandidates.length >= 2) {
                return [evaluated ? literalCandidates[0] : literalCandidates[1]];
            }
        }
    }
    return [];
}

function extractFilePathFromMethodSignature(methodSig: string): string {
    const m = String(methodSig || "").match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : "";
}

function resolveBooleanParamBindings(
    queries: BuildAppStorageModelArgs["queries"],
    method: any,
    invokeArgs: any[],
): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const paramStmt of queries.collectParameterAssignStmts(method)) {
        const right: any = paramStmt.getRightOp?.();
        const index = right instanceof ArkParameterRef ? right.getIndex?.() : undefined;
        if (typeof index !== "number" || index < 0 || index >= invokeArgs.length) continue;
        const actualArg = invokeArgs[index];
        const boolValue = parseBooleanLiteral(actualArg);
        if (boolValue === undefined) continue;
        const leftText = String(paramStmt.getLeftOp?.()?.toString?.() || "").trim();
        if (!leftText) continue;
        out.set(leftText, boolValue);
    }
    return out;
}

function parseBooleanLiteral(value: any): boolean | undefined {
    const text = String(value?.toString?.() || "").trim();
    if (text === "true") return true;
    if (text === "false") return false;
    return undefined;
}

function tryResolveBooleanStorageLiteral(value: any, bindings: Map<string, boolean>): string | undefined {
    if (bindings.size === 0) return undefined;
    let exprText = String(value?.toString?.() || "").trim();
    exprText = stripOuterParens(exprText);
    const ternary = exprText.match(/^(.+?)\?\s*(['"`](?:\\.|[^'"`])+['"`])\s*:\s*(['"`](?:\\.|[^'"`])+['"`])$/);
    if (!ternary) return undefined;
    const conditionText = stripOuterParens(String(ternary[1] || "").trim());
    for (const [paramName, boolValue] of bindings.entries()) {
        const evaluated = evaluateBooleanCondition(conditionText, paramName, boolValue);
        if (evaluated === undefined) continue;
        return normalizeStorageKey(evaluated ? ternary[2] : ternary[3]);
    }
    return undefined;
}

function extractQuotedStorageLiterals(value: any): string[] {
    const out = new Set<string>();
    const raw = String(value?.toString?.() || "");
    const pattern = /(['"`])((?:\\.|(?!\1).)+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
        const normalized = normalizeStorageKey(match[0]);
        if (normalized) {
            out.add(normalized);
        }
    }
    return [...out.values()];
}

function stripOuterParens(text: string): string {
    let out = String(text || "").trim();
    while (out.startsWith("(") && out.endsWith(")")) {
        out = out.slice(1, -1).trim();
    }
    return out;
}

function evaluateBooleanCondition(text: string, paramName: string, value: boolean): boolean | undefined {
    const normalized = stripOuterParens(text.replace(/\s+/g, ""));
    const param = escapeForRegex(paramName);
    if (new RegExp(`^${param}$`).test(normalized)) return value;
    if (new RegExp(`^!${param}$`).test(normalized)) return !value;
    if (new RegExp(`^${param}(===|==)true$`).test(normalized)) return value;
    if (new RegExp(`^${param}(===|==)false$`).test(normalized)) return !value;
    if (new RegExp(`^${param}(!==|!=)true$`).test(normalized)) return !value;
    if (new RegExp(`^${param}(!==|!=)false$`).test(normalized)) return value;
    if (new RegExp(`^true(===|==)${param}$`).test(normalized)) return value;
    if (new RegExp(`^false(===|==)${param}$`).test(normalized)) return !value;
    if (new RegExp(`^true(!==|!=)${param}$`).test(normalized)) return !value;
    if (new RegExp(`^false(!==|!=)${param}$`).test(normalized)) return value;
    return undefined;
}

function escapeForRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function traceDynamicKeyExprByLocal(local: Local): string | undefined {
    const visited = new Set<string>();
    let current: any = local;
    let steps = 0;
    const maxSteps = 8;

    while (current instanceof Local && steps < maxSteps) {
        const localName = current.getName?.() || current.toString?.() || "<local>";
        if (visited.has(localName)) break;
        visited.add(localName);

        const declStmt: any = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        const right = declStmt.getRightOp?.();
        if (!right) break;
        const rightLiteral = resolveStorageKeyLiteral(right);
        if (rightLiteral) return `'${rightLiteral}'`;
        if (right instanceof Local) {
            current = right;
            steps++;
            continue;
        }
        return String(right.toString?.() || "").trim();
    }

    return undefined;
}

function normalizeStorageKey(raw: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw).trim();
    if (text.length === 0) return undefined;
    const quoted = parseClosedQuotedText(text);
    if (quoted !== undefined) return quoted;
    if (/^[A-Za-z0-9_.:-]+$/.test(text)) {
        return text;
    }
    return undefined;
}

function parseClosedQuotedText(text: string): string | undefined {
    if (text.length < 2) return undefined;
    const quote = text[0];
    if ((quote !== "'" && quote !== "\"" && quote !== "`") || text[text.length - 1] !== quote) {
        return undefined;
    }
    let out = "";
    let escaping = false;
    for (let i = 1; i < text.length - 1; i++) {
        const ch = text[i];
        if (escaping) {
            out += ch;
            escaping = false;
            continue;
        }
        if (ch === "\\") {
            escaping = true;
            continue;
        }
        if (ch === quote) {
            return undefined;
        }
        out += ch;
    }
    if (escaping) return undefined;
    return out;
}

function collectDecoratedStorageFieldsBySignature(scene: Scene): Map<string, DecoratedStorageFieldInfo[]> {
    const out = new Map<string, DecoratedStorageFieldInfo[]>();
    for (const cls of scene.getClasses()) {
        for (const field of cls.getFields()) {
            const decorators = field.getDecorators() || [];
            if (decorators.length === 0) continue;
            for (const decorator of decorators) {
                if (!isStorageDecorator(decorator)) continue;
                const key = extractDecoratorStorageKey(decorator);
                if (!key) continue;
                const fieldSignature = field.getSignature()?.toString?.() || "";
                if (!fieldSignature) continue;
                if (!out.has(fieldSignature)) out.set(fieldSignature, []);
                out.get(fieldSignature)!.push({
                    key,
                    fieldName: field.getName(),
                    fieldSignature,
                    decoratorKind: decorator.getKind?.() || "",
                });
            }
        }
    }
    return out;
}

function isStorageDecorator(decorator: Decorator): boolean {
    return STORAGE_DECORATOR_KINDS.has(decorator.getKind?.() || "");
}

function extractDecoratorStorageKey(decorator: Decorator): string | undefined {
    const fromParam = normalizeStorageKey(decorator.getParam?.() || "");
    if (fromParam) return fromParam;
    const content = decorator.getContent?.() || "";
    const m = content.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (!m) return undefined;
    return normalizeStorageKey(m[1]);
}

function collectDecoratorFieldEndpoints(
    fieldRef: ArkInstanceFieldRef,
    decoratedFieldsBySignature: Map<string, DecoratedStorageFieldInfo[]>,
    pag: Pag,
    addFieldEndpoint: (key: string, endpoint: AppStorageFieldEndpoint) => void,
    addFieldNodeId: (key: string, fieldNodeId: number) => void
): void {
    const fieldSignature = fieldRef.getFieldSignature().toString();
    const decorated = decoratedFieldsBySignature.get(fieldSignature);
    if (!decorated || decorated.length === 0) return;

    const fieldNodes = pag.getNodesByValue(fieldRef);
    if (fieldNodes && fieldNodes.size > 0) {
        for (const info of decorated) {
            for (const fieldNodeId of fieldNodes.values()) {
                addFieldNodeId(info.key, fieldNodeId);
            }
        }
    }

    const base = fieldRef.getBase();
    const baseNodes = pag.getNodesByValue(base);
    if (!baseNodes || baseNodes.size === 0) return;

    const objectNodeIds = new Set<number>();
    for (const baseNodeId of baseNodes.values()) {
        const baseNode: any = pag.getNode(baseNodeId);
        const pointsTo: Iterable<number> = baseNode?.getPointTo?.() || [];
        for (const objectNodeId of pointsTo) {
            objectNodeIds.add(objectNodeId);
        }
    }
    if (objectNodeIds.size === 0) return;

    for (const info of decorated) {
        for (const objectNodeId of objectNodeIds) {
            addFieldEndpoint(info.key, {
                objectNodeId,
                fieldName: info.fieldName,
            });
        }
    }
}

function collectDecoratorFieldWrites(
    fieldRef: ArkInstanceFieldRef,
    decoratedFieldsBySignature: Map<string, DecoratedStorageFieldInfo[]>,
    pag: Pag,
    addWriteFieldNodeId: (key: string, nodeId: number) => void,
    addWriteFieldEndpoint: (key: string, endpoint: AppStorageFieldEndpoint) => void
): void {
    const fieldSignature = fieldRef.getFieldSignature().toString();
    const decorated = decoratedFieldsBySignature.get(fieldSignature);
    if (!decorated || decorated.length === 0) return;

    const linkDecorated = decorated.filter(
        info => info.decoratorKind === DECORATOR_STORAGE_LINK
            || info.decoratorKind === DECORATOR_LOCAL_STORAGE_LINK
    );
    if (linkDecorated.length === 0) return;

    const fieldNodes = pag.getNodesByValue(fieldRef);
    if (!fieldNodes || fieldNodes.size === 0) return;
    for (const info of linkDecorated) {
        for (const nodeId of fieldNodes.values()) {
            addWriteFieldNodeId(info.key, nodeId);
        }
    }

    const base = fieldRef.getBase();
    const baseNodes = pag.getNodesByValue(base);
    if (!baseNodes || baseNodes.size === 0) return;
    const objectNodeIds = new Set<number>();
    for (const baseNodeId of baseNodes.values()) {
        const baseNode: any = pag.getNode(baseNodeId);
        const pointsTo: Iterable<number> = baseNode?.getPointTo?.() || [];
        for (const objectNodeId of pointsTo) {
            objectNodeIds.add(objectNodeId);
        }
    }
    if (objectNodeIds.size === 0) return;
    for (const info of linkDecorated) {
        for (const objectNodeId of objectNodeIds) {
            addWriteFieldEndpoint(info.key, {
                objectNodeId,
                fieldName: info.fieldName,
            });
        }
    }
}

function collectDecoratorFieldWriteSourceNodes(
    leftFieldRef: ArkInstanceFieldRef,
    rightValue: any,
    decoratedFieldsBySignature: Map<string, DecoratedStorageFieldInfo[]>,
    pag: Pag,
    addWriteNodeId: (key: string, nodeId: number) => void
): void {
    const fieldSignature = leftFieldRef.getFieldSignature().toString();
    const decorated = decoratedFieldsBySignature.get(fieldSignature);
    if (!decorated || decorated.length === 0) return;
    const linkDecorated = decorated.filter(
        info => info.decoratorKind === DECORATOR_STORAGE_LINK
            || info.decoratorKind === DECORATOR_LOCAL_STORAGE_LINK
    );
    if (linkDecorated.length === 0) return;

    const rightNodes = pag.getNodesByValue(rightValue);
    if (!rightNodes || rightNodes.size === 0) return;
    for (const info of linkDecorated) {
        for (const nodeId of rightNodes.values()) {
            addWriteNodeId(info.key, nodeId);
        }
    }
}
