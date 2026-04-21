import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { Decorator } from "../../../../../arkanalyzer/out/src/core/base/Decorator";
import { StringType } from "../../../../../arkanalyzer/out/src/core/base/Type";
import {
    defineModule,
    type TaintModule,
} from "../../../kernel/contracts/ModuleApi";
import type {
    AppStorageDynamicKeyWarning,
    AppStorageFieldEndpoint,
    AppStorageSemanticModel,
    BuildAppStorageSemanticModelArgs,
} from "../../../kernel/contracts/AppStorageModuleProvider";
import {
    collectObjectNodeIdsFromValueInMethod,
    resolveHarmonyMethods,
} from "../../../kernel/contracts/HarmonyModuleUtils";

export interface HarmonyKeyedStorageSemanticsOptions {
    id?: string;
    description?: string;
    storageClasses?: string[];
    writeMethods?: Array<{ methodName: string; valueIndex: number }>;
    readMethods?: string[];
    propDecorators?: string[];
    linkDecorators?: string[];
}

const DEFAULT_APPSTORAGE_OPTIONS: Required<HarmonyKeyedStorageSemanticsOptions> = {
    id: "harmony.appstorage",
    description: "Built-in Harmony AppStorage/LocalStorage/PersistentStorage semantics.",
    storageClasses: [
        "AppStorage",
        "LocalStorage",
        "PersistentStorage",
    ],
    writeMethods: [
        { methodName: "set", valueIndex: 1 },
        { methodName: "setOrCreate", valueIndex: 1 },
        { methodName: "persistProp", valueIndex: 1 },
    ],
    readMethods: [
        "get",
        "prop",
        "link",
        "setOrCreate",
    ],
    propDecorators: [
        "StorageProp",
        "LocalStorageProp",
    ],
    linkDecorators: [
        "StorageLink",
        "LocalStorageLink",
    ],
};

interface BuildAppStorageInternalOptions {
    storageApiClasses: Set<string>;
    writeMethodsByName: Map<string, number>;
    readMethodNames: Set<string>;
    propDecoratorKinds: Set<string>;
    linkDecoratorKinds: Set<string>;
    storageDecoratorKinds: Set<string>;
}

export function createHarmonyKeyedStorageSemanticModule(
    options: HarmonyKeyedStorageSemanticsOptions = {},
): TaintModule {
    const resolved = {
        ...DEFAULT_APPSTORAGE_OPTIONS,
        ...options,
        storageClasses: options.storageClasses && options.storageClasses.length > 0
            ? [...options.storageClasses]
            : [...DEFAULT_APPSTORAGE_OPTIONS.storageClasses],
        writeMethods: options.writeMethods && options.writeMethods.length > 0
            ? options.writeMethods.map(item => ({ ...item }))
            : DEFAULT_APPSTORAGE_OPTIONS.writeMethods.map(item => ({ ...item })),
        readMethods: options.readMethods && options.readMethods.length > 0
            ? [...options.readMethods]
            : [...DEFAULT_APPSTORAGE_OPTIONS.readMethods],
        propDecorators: options.propDecorators && options.propDecorators.length > 0
            ? [...options.propDecorators]
            : [...DEFAULT_APPSTORAGE_OPTIONS.propDecorators],
        linkDecorators: options.linkDecorators && options.linkDecorators.length > 0
            ? [...options.linkDecorators]
            : [...DEFAULT_APPSTORAGE_OPTIONS.linkDecorators],
    };
    const internalOptions: BuildAppStorageInternalOptions = {
        storageApiClasses: new Set(resolved.storageClasses),
        writeMethodsByName: new Map(resolved.writeMethods.map(item => [item.methodName, item.valueIndex])),
        readMethodNames: new Set(resolved.readMethods),
        propDecoratorKinds: new Set(resolved.propDecorators),
        linkDecoratorKinds: new Set(resolved.linkDecorators),
        storageDecoratorKinds: new Set([...resolved.propDecorators, ...resolved.linkDecorators]),
    };

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            const model = buildAppStorageModel({
                scene: ctx.raw.scene,
                pag: ctx.raw.pag,
                allowedMethodSignatures: ctx.raw.allowedMethodSignatures,
                analysis: ctx.analysis,
                scan: ctx.scan,
            }, internalOptions);
            const writeKeysByNodeId = new Map<number, string[]>();
            const writeKeysByFieldEndpoint = new Map<string, string[]>();
            const slotTaintStates = new Set<string>();

            for (const [key, nodeIds] of model.writeNodeIdsByKey.entries()) {
                for (const nodeId of nodeIds) {
                    if (!writeKeysByNodeId.has(nodeId)) {
                        writeKeysByNodeId.set(nodeId, []);
                    }
                    writeKeysByNodeId.get(nodeId)!.push(key);
                }
            }
            for (const [key, nodeIds] of model.writeFieldNodeIdsByKey.entries()) {
                for (const nodeId of nodeIds) {
                    if (!writeKeysByNodeId.has(nodeId)) {
                        writeKeysByNodeId.set(nodeId, []);
                    }
                    writeKeysByNodeId.get(nodeId)!.push(key);
                }
            }
            for (const [key, endpoints] of model.writeFieldEndpointsByKey.entries()) {
                for (const endpoint of endpoints) {
                    const endpointKey = `${endpoint.objectNodeId}#${endpoint.fieldName}`;
                    if (!writeKeysByFieldEndpoint.has(endpointKey)) {
                        writeKeysByFieldEndpoint.set(endpointKey, []);
                    }
                    writeKeysByFieldEndpoint.get(endpointKey)!.push(key);
                }
            }

            if (model.dynamicKeyWarnings.length > 0) {
                ctx.log(`[Harmony-AppStorage] dynamic key warnings=${model.dynamicKeyWarnings.length} (only constant-ish keys are modeled).`);
            }
            ctx.debug.summary("Harmony-AppStorage", {
                write_keys: model.writeNodeIdsByKey.size + model.writeFieldNodeIdsByKey.size,
                read_keys: model.readNodeIdsByKey.size + model.readFieldNodeIdsByKey.size,
                dynamic_key_warnings: model.dynamicKeyWarnings.length,
            });

            return {
                onFact(event) {
                    const writeKeySet = new Set<string>(writeKeysByNodeId.get(event.current.nodeId) || []);
                    const fieldHead = event.current.fieldHead();
                    if (fieldHead) {
                        const endpointKey = `${event.current.nodeId}#${fieldHead}`;
                        for (const key of writeKeysByFieldEndpoint.get(endpointKey) || []) {
                            writeKeySet.add(key);
                        }
                    }
                    if (writeKeySet.size === 0) return;

                    const emissions = event.emit.collector();

                    for (const key of writeKeySet) {
                        const slotStateKey = `${key}|${event.current.source}|${event.current.contextId}|${event.current.field ? event.current.field.join(".") : ""}`;
                        if (slotTaintStates.has(slotStateKey)) continue;
                        slotTaintStates.add(slotStateKey);

                        const readNodeIds = model.readNodeIdsByKey.get(key);
                        if (readNodeIds) {
                            for (const readNodeId of readNodeIds) {
                                emissions.push(event.emit.preserveToNode(readNodeId, "AppStorage-Read"));
                            }
                        }

                        const readFieldNodeIds = model.readFieldNodeIdsByKey.get(key);
                        if (readFieldNodeIds) {
                            for (const fieldNodeId of readFieldNodeIds) {
                                emissions.push(event.emit.preserveToNode(fieldNodeId, "AppStorage-DecorFieldNode"));
                            }
                        }

                        for (const endpoint of model.readFieldEndpointsByKey.get(key) || []) {
                            const isSelfEndpointEcho = event.current.nodeId === endpoint.objectNodeId
                                && fieldHead === endpoint.fieldName;
                            if (isSelfEndpointEcho) continue;
                            emissions.push(event.emit.toField(endpoint.objectNodeId, [endpoint.fieldName], "AppStorage-Decor"));
                        }
                    }

                    return emissions.done();
                },
            };
        },
    });
}

export const harmonyAppStorageSemanticModule = createHarmonyKeyedStorageSemanticModule();
export const harmonyAppStorageModule: TaintModule = harmonyAppStorageSemanticModule;

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

export function buildAppStorageModel(
    args: BuildAppStorageModelArgs,
    options: BuildAppStorageInternalOptions = {
        storageApiClasses: new Set(DEFAULT_APPSTORAGE_OPTIONS.storageClasses),
        writeMethodsByName: new Map(DEFAULT_APPSTORAGE_OPTIONS.writeMethods.map(item => [item.methodName, item.valueIndex])),
        readMethodNames: new Set(DEFAULT_APPSTORAGE_OPTIONS.readMethods),
        propDecoratorKinds: new Set(DEFAULT_APPSTORAGE_OPTIONS.propDecorators),
        linkDecoratorKinds: new Set(DEFAULT_APPSTORAGE_OPTIONS.linkDecorators),
        storageDecoratorKinds: new Set([
            ...DEFAULT_APPSTORAGE_OPTIONS.propDecorators,
            ...DEFAULT_APPSTORAGE_OPTIONS.linkDecorators,
        ]),
    },
): AppStorageModel {
    const writeNodeIdsByKey = new Map<string, Set<number>>();
    const writeFieldNodeIdsByKey = new Map<string, Set<number>>();
    const writeFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readNodeIdsByKey = new Map<string, Set<number>>();
    const readFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readFieldNodeIdsByKey = new Map<string, Set<number>>();
    const warningByKey = new Map<string, AppStorageDynamicKeyWarning>();

    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    const decoratedFieldsBySignature = collectDecoratedStorageFieldsBySignature(
        args.scene,
        options.storageDecoratorKinds,
    );
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
        if (options.storageApiClasses.has(ownerClassName)) {
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
            if (!options.storageApiClasses.has(className)) {
                continue;
            }
            const apiName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const callSignature = methodSig?.toString?.() || "";
            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) continue;

            const keyArg = invokeArgs[0];
            const keyToken = resolveStorageKeyToken(args, methodSignature, keyArg);
            if (!keyToken) {
                addDynamicKeyWarning({
                    methodSignature,
                    callSignature,
                    apiName,
                    keyExprText: keyArg?.toString?.() || "<unknown>",
                });
                continue;
            }
            const scopedKeys = buildScopedStorageKeys(
                resolveStorageScopeTokens(args, method, stmt, invokeExpr, className),
                keyToken.keys,
            );
            if (keyToken.dynamic) {
                addDynamicKeyWarning({
                    methodSignature,
                    callSignature,
                    apiName,
                    keyExprText: keyToken.keyExprText,
                });
            }

            const writeValueIndex = options.writeMethodsByName.get(apiName);
            if (writeValueIndex !== undefined) {
                if (invokeArgs.length > writeValueIndex) {
                    const valueArg = invokeArgs[writeValueIndex];
                    const writeNodeIds = collectPagNodeIdsByValue(args.pag, valueArg);
                    for (const key of scopedKeys) {
                        for (const nodeId of writeNodeIds) {
                            addWriteNodeId(key, nodeId);
                        }
                    }
                }
            }

            if (options.readMethodNames.has(apiName)) {
                if (stmt instanceof ArkAssignStmt) {
                    const leftOp = stmt.getLeftOp();
                    const readNodeIds = collectPagNodeIdsByValue(args.pag, leftOp);
                    for (const key of scopedKeys) {
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
                    collectDecoratorFieldEndpoints(method, left, decoratedFieldsBySignature, args.pag, addFieldEndpoint, addFieldNodeId);
                    collectDecoratorFieldWriteSourceNodes(left, right, decoratedFieldsBySignature, options.linkDecoratorKinds, args.pag, addWriteNodeId);
                    collectDecoratorFieldWrites(method, left, decoratedFieldsBySignature, options.linkDecoratorKinds, args.pag, addWriteFieldNodeId, addWriteFieldEndpoint);
                }
                if (right instanceof ArkInstanceFieldRef) {
                    collectDecoratorFieldEndpoints(method, right, decoratedFieldsBySignature, args.pag, addFieldEndpoint, addFieldNodeId);
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

function buildScopedStorageKeys(scopeTokens: string[], keys: string[]): string[] {
    const out = new Set<string>();
    for (const scopeToken of scopeTokens) {
        for (const key of keys) {
            out.add(scopeToken ? `${scopeToken}::${key}` : key);
        }
    }
    return [...out];
}

function resolveStorageScopeTokens(
    args: BuildAppStorageModelArgs,
    method: any,
    stmt: any,
    invokeExpr: any,
    className: string,
): string[] {
    if (invokeExpr instanceof ArkStaticInvokeExpr) {
        return [""];
    }
    const scopeTokens = new Set<string>();
    const base = invokeExpr.getBase?.();
    if (base !== undefined) {
        const directNodeIds = args.analysis.nodeIdsForValue(base, stmt);
        for (const nodeId of directNodeIds) {
            scopeTokens.add(`node:${nodeId}`);
        }
        if (scopeTokens.size === 0) {
            const carrierNodeIds = args.analysis.carrierNodeIdsForValue(base, stmt);
            for (const nodeId of carrierNodeIds) {
                scopeTokens.add(`carrier:${nodeId}`);
            }
        }
        if (scopeTokens.size === 0) {
            for (const nodeId of args.analysis.objectNodeIdsForValue(base)) {
                scopeTokens.add(`obj:${nodeId}`);
            }
        }
        if (scopeTokens.size === 0) {
            const fallbackObjectNodeIds = collectObjectNodeIdsFromValueInMethod(args.pag, method, base);
            for (const nodeId of fallbackObjectNodeIds) {
                scopeTokens.add(`obj:${nodeId}`);
            }
        }
    }
    if (scopeTokens.size === 0) {
        scopeTokens.add(`class:${className}`);
    }
    return [...scopeTokens].map(token => `${className}::${token}`);
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
    args: BuildAppStorageModelArgs,
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
        const sameFileCandidates = collectSameFileLocalKeyCandidates(args, methodSignature, value);
        if (sameFileCandidates.length >= 1) {
            return {
                keys: sameFileCandidates,
                dynamic: sameFileCandidates.length > 1,
                keyExprText: String(value?.toString?.() || "").trim(),
            };
        }
        const localCandidates = args.analysis.stringCandidates(value);
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
    const candidates = args.analysis.stringCandidates(value);
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
    args: BuildAppStorageModelArgs,
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
    for (const method of args.scene.getMethods()) {
        if (method.getName?.() !== targetMethodName) continue;
        if (extractFilePathFromMethodSignature(method.getSignature?.().toString?.() || "") !== sourceFilePath) {
            continue;
        }
        const booleanBindings = resolveBooleanParamBindings(args.scan, method, invokeArgs);
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
    scan: BuildAppStorageModelArgs["scan"],
    method: any,
    invokeArgs: any[],
): Map<string, boolean> {
    const out = new Map<string, boolean>();
    const methodSignature = method?.getSignature?.()?.toString?.() || "";
    for (const binding of scan.parameterBindings({ ownerMethodSignature: methodSignature })) {
        const index = binding.paramIndex;
        if (typeof index !== "number" || index < 0 || index >= invokeArgs.length) continue;
        const actualArg = invokeArgs[index];
        const boolValue = parseBooleanLiteral(actualArg);
        if (boolValue === undefined) continue;
        const leftText = String(binding.local()?.toString?.() || "").trim();
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

function collectDecoratedStorageFieldsBySignature(
    scene: Scene,
    storageDecoratorKinds: Set<string>,
): Map<string, DecoratedStorageFieldInfo[]> {
    const out = new Map<string, DecoratedStorageFieldInfo[]>();
    for (const cls of scene.getClasses()) {
        for (const field of cls.getFields()) {
            const decorators = field.getDecorators() || [];
            if (decorators.length === 0) continue;
            for (const decorator of decorators) {
                if (!isStorageDecorator(decorator, storageDecoratorKinds)) continue;
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

function isStorageDecorator(decorator: Decorator, storageDecoratorKinds: Set<string>): boolean {
    return storageDecoratorKinds.has(decorator.getKind?.() || "");
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
    method: any,
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

    const objectNodeIds = collectObjectNodeIdsFromValueInMethod(pag, method, fieldRef.getBase());
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
    method: any,
    fieldRef: ArkInstanceFieldRef,
    decoratedFieldsBySignature: Map<string, DecoratedStorageFieldInfo[]>,
    linkDecoratorKinds: Set<string>,
    pag: Pag,
    addWriteFieldNodeId: (key: string, nodeId: number) => void,
    addWriteFieldEndpoint: (key: string, endpoint: AppStorageFieldEndpoint) => void
): void {
    const fieldSignature = fieldRef.getFieldSignature().toString();
    const decorated = decoratedFieldsBySignature.get(fieldSignature);
    if (!decorated || decorated.length === 0) return;

    const linkDecorated = decorated.filter(info => linkDecoratorKinds.has(info.decoratorKind));
    if (linkDecorated.length === 0) return;

    const fieldNodes = pag.getNodesByValue(fieldRef);
    if (!fieldNodes || fieldNodes.size === 0) return;
    for (const info of linkDecorated) {
        for (const nodeId of fieldNodes.values()) {
            addWriteFieldNodeId(info.key, nodeId);
        }
    }

    const objectNodeIds = collectObjectNodeIdsFromValueInMethod(pag, method, fieldRef.getBase());
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
    linkDecoratorKinds: Set<string>,
    pag: Pag,
    addWriteNodeId: (key: string, nodeId: number) => void
): void {
    const fieldSignature = leftFieldRef.getFieldSignature().toString();
    const decorated = decoratedFieldsBySignature.get(fieldSignature);
    if (!decorated || decorated.length === 0) return;
    const linkDecorated = decorated.filter(info => linkDecoratorKinds.has(info.decoratorKind));
    if (linkDecorated.length === 0) return;

    const rightNodes = pag.getNodesByValue(rightValue);
    if (!rightNodes || rightNodes.size === 0) return;
    for (const info of linkDecorated) {
        for (const nodeId of rightNodes.values()) {
            addWriteNodeId(info.key, nodeId);
        }
    }
}

export default harmonyAppStorageModule;

