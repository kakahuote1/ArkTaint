import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { StringType } from "../../../../../arkanalyzer/out/src/core/base/Type";
import {
    defineModule,
    type TaintModule,
} from "../../../kernel/contracts/ModuleApi";
import type { ModuleScannedInvoke } from "../../../kernel/contracts/ModuleContract";
import type {
    AppStorageDynamicKeyWarning,
    AppStorageFieldEndpoint,
    AppStorageNodeOperation,
    AppStorageSemanticModel,
    BuildAppStorageSemanticModelArgs,
} from "../../../kernel/contracts/AppStorageModuleProvider";
import {
    addMapSetValue,
    collectObjectNodeIdsFromValueInMethod,
    resolveHarmonyMethods,
} from "../../../kernel/contracts/HarmonyModuleUtils";
import {
    isConsumableSemanticEndpointProjection,
} from "../../../kernel/contracts/PagNodeResolution";
import type { AssetEndpoint } from "../../../assets/schema";
import type { SemanticEffectSite } from "../../../api/effects/SemanticEffectSite";
import { createHandoffPropagationSession } from "../../../kernel/semantic_handoff/SemanticHandoffPropagation";
import { HandoffEffect, createExactHandoffHandle } from "../../../kernel/semantic_handoff/SemanticHandoffTypes";

type KeyedStorageUpdateStrength = "strong" | "weak";

interface HarmonyKeyedStorageWriteApiOption {
    canonicalApiIds: string[];
    valueIndex: number;
    updateStrength?: KeyedStorageUpdateStrength;
}

export interface HarmonyKeyedStorageSemanticsOptions {
    id?: string;
    description?: string;
    writeApis?: HarmonyKeyedStorageWriteApiOption[];
    writeResultApis?: HarmonyKeyedStorageWriteApiOption[];
    readCanonicalApiIds?: string[];
    killCanonicalApiIds?: string[];
    propDecoratorCanonicalApiIds?: string[];
    linkDecoratorCanonicalApiIds?: string[];
}

const DEFAULT_APPSTORAGE_OPTIONS: Required<HarmonyKeyedStorageSemanticsOptions> = {
    id: "harmony.appstorage",
    description: "Built-in Harmony AppStorage/LocalStorage/PersistentStorage semantics.",
    writeApis: [],
    writeResultApis: [],
    readCanonicalApiIds: [],
    killCanonicalApiIds: [],
    propDecoratorCanonicalApiIds: [],
    linkDecoratorCanonicalApiIds: [],
};

interface RuntimeWriteApiSpec {
    valueIndex: number;
    updateStrength?: KeyedStorageUpdateStrength;
}

interface BuildAppStorageInternalOptions {
    writeSpecByCanonicalApiId: Map<string, RuntimeWriteApiSpec>;
    writeResultSpecByCanonicalApiId: Map<string, RuntimeWriteApiSpec>;
    readCanonicalApiIds: Set<string>;
    killCanonicalApiIds: Set<string>;
    propDecoratorCanonicalApiIds: Set<string>;
    linkDecoratorCanonicalApiIds: Set<string>;
}

export function createHarmonyKeyedStorageSemanticModule(
    options: HarmonyKeyedStorageSemanticsOptions = {},
): TaintModule {
    const resolved = {
        ...DEFAULT_APPSTORAGE_OPTIONS,
        ...options,
        writeApis: normalizeWriteApiOptions(options.writeApis, DEFAULT_APPSTORAGE_OPTIONS.writeApis),
        writeResultApis: normalizeWriteApiOptions(options.writeResultApis, DEFAULT_APPSTORAGE_OPTIONS.writeResultApis),
        readCanonicalApiIds: options.readCanonicalApiIds && options.readCanonicalApiIds.length > 0
            ? [...options.readCanonicalApiIds]
            : [],
        killCanonicalApiIds: options.killCanonicalApiIds && options.killCanonicalApiIds.length > 0
            ? [...options.killCanonicalApiIds]
            : [],
        propDecoratorCanonicalApiIds: options.propDecoratorCanonicalApiIds && options.propDecoratorCanonicalApiIds.length > 0
            ? [...options.propDecoratorCanonicalApiIds]
            : [...DEFAULT_APPSTORAGE_OPTIONS.propDecoratorCanonicalApiIds],
        linkDecoratorCanonicalApiIds: options.linkDecoratorCanonicalApiIds && options.linkDecoratorCanonicalApiIds.length > 0
            ? [...options.linkDecoratorCanonicalApiIds]
            : [...DEFAULT_APPSTORAGE_OPTIONS.linkDecoratorCanonicalApiIds],
    };
    const internalOptions: BuildAppStorageInternalOptions = {
        writeSpecByCanonicalApiId: writeSpecMap(resolved.writeApis),
        writeResultSpecByCanonicalApiId: writeSpecMap(resolved.writeResultApis),
        readCanonicalApiIds: new Set(resolved.readCanonicalApiIds),
        killCanonicalApiIds: new Set(resolved.killCanonicalApiIds),
        propDecoratorCanonicalApiIds: new Set(resolved.propDecoratorCanonicalApiIds),
        linkDecoratorCanonicalApiIds: new Set(resolved.linkDecoratorCanonicalApiIds),
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
            const handoff = createHandoffPropagationSession(buildAppStorageHandoffEffects(model), {
                currentnessAnalysis: ctx.raw.currentnessAnalysis,
            });

            if (model.dynamicKeyWarnings.length > 0) {
                ctx.log(`[Harmony-AppStorage] dynamic key warnings=${model.dynamicKeyWarnings.length} (only constant-ish keys are modeled).`);
            }
            ctx.debug.summary("Harmony-AppStorage", {
                decorator_occurrences: ctx.raw.canonicalDecoratorOccurrences?.length || 0,
                requested_prop_decorator_ids: resolved.propDecoratorCanonicalApiIds.length,
                requested_link_decorator_ids: resolved.linkDecoratorCanonicalApiIds.length,
                write_keys: model.writeNodeIdsByKey.size + model.writeFieldNodeIdsByKey.size,
                read_keys: model.readNodeIdsByKey.size + model.readFieldNodeIdsByKey.size,
                write_field_endpoint_keys: model.writeFieldEndpointsByKey.size,
                read_field_endpoint_keys: model.readFieldEndpointsByKey.size,
                prop_decorator_fields: model.debug?.propDecoratorStats?.fields || 0,
                prop_decorator_keyed_fields: model.debug?.propDecoratorStats?.keyedFields || 0,
                prop_decorator_loads: model.debug?.propDecoratorStats?.loads || 0,
                prop_decorator_read_nodes: model.debug?.propDecoratorStats?.readNodes || 0,
                prop_decorator_read_endpoints: model.debug?.propDecoratorStats?.readEndpoints || 0,
                link_decorator_fields: model.debug?.linkDecoratorStats?.fields || 0,
                link_decorator_keyed_fields: model.debug?.linkDecoratorStats?.keyedFields || 0,
                dynamic_key_warnings: model.dynamicKeyWarnings.length,
            });

            return {
                onFact(event) {
                    return handoff.emitForFact(event);
                },
            };
        },
    });
}

function normalizeWriteApiOptions(
    value: HarmonyKeyedStorageWriteApiOption[] | undefined,
    fallback: HarmonyKeyedStorageWriteApiOption[],
): HarmonyKeyedStorageWriteApiOption[] {
    const source = value && value.length > 0 ? value : fallback;
    return source.map(item => ({
        valueIndex: item.valueIndex,
        canonicalApiIds: [...new Set(item.canonicalApiIds || [])].sort((left, right) => left.localeCompare(right)),
        ...(item.updateStrength === "strong" || item.updateStrength === "weak"
            ? { updateStrength: item.updateStrength }
            : {}),
    }));
}

function writeSpecMap(items: HarmonyKeyedStorageWriteApiOption[]): Map<string, RuntimeWriteApiSpec> {
    return new Map(items.flatMap(item =>
        item.canonicalApiIds.map(canonicalApiId => [canonicalApiId, {
            valueIndex: item.valueIndex,
            ...(item.updateStrength ? { updateStrength: item.updateStrength } : {}),
        }] as [string, RuntimeWriteApiSpec]),
    ));
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map(item => String(item || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

export const harmonyAppStorageSemanticModule = createHarmonyKeyedStorageSemanticModule();
export const harmonyAppStorageModule: TaintModule = harmonyAppStorageSemanticModule;

export type AppStorageModel = AppStorageSemanticModel;
export type BuildAppStorageModelArgs = BuildAppStorageSemanticModelArgs;

const APPSTORAGE_HANDOFF_FAMILY = "harmony.keyed_storage";
const APPSTORAGE_CELL_KIND = "keyed-semantic-slot";

function buildAppStorageHandoffEffects(model: AppStorageModel): HandoffEffect[] {
    const effects: HandoffEffect[] = [];
    const sequencedWriteNodes = new Set<string>();
    const sequencedReadNodes = new Set<string>();

    for (const [key, operations] of model.writeOperationsByKey.entries()) {
        for (const op of operations) {
            const handle = createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key);
            const sequence = appStorageOperationSequence(op);
            const updateStrength = op.updateStrength || "strong";
            sequencedWriteNodes.add(`${key}#${op.nodeId}`);
            if (updateStrength !== "weak") {
                effects.push({
                    kind: "kill",
                    handle,
                    reason: "AppStorage-Write",
                    originModel: "harmony.appstorage",
                    programPoint: appStorageProgramPoint(op),
                    flowScope: op.methodSignature,
                    sequence,
                    updateStrength: "strong",
                    confidence: "certain",
                });
            }
            effects.push({
                kind: "put",
                handle,
                source: { nodeId: op.nodeId },
                reason: "AppStorage-Write",
                originModel: "harmony.appstorage",
                programPoint: appStorageProgramPoint(op),
                flowScope: op.methodSignature,
                sequence: sequence + 1,
                updateStrength,
                confidence: "certain",
            });
        }
    }

    for (const [key, operations] of model.killOperationsByKey.entries()) {
        for (const op of operations) {
            effects.push({
                kind: "kill",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                reason: "AppStorage-Kill",
                originModel: "harmony.appstorage",
                programPoint: appStorageProgramPoint(op),
                flowScope: op.methodSignature,
                sequence: op.stmtIndex * 10,
                updateStrength: "strong",
                confidence: "certain",
            });
        }
    }

    for (const [key, operations] of model.cleanOverwriteOperationsByKey.entries()) {
        for (const op of operations) {
            effects.push({
                kind: "kill",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                reason: "AppStorage-CleanOverwrite",
                originModel: "harmony.appstorage",
                programPoint: appStorageProgramPoint(op),
                flowScope: op.methodSignature,
                sequence: op.stmtIndex * 10,
                updateStrength: "strong",
                confidence: "certain",
            });
        }
    }

    for (const [key, nodeIds] of model.writeNodeIdsByKey.entries()) {
        for (const nodeId of nodeIds) {
            if (sequencedWriteNodes.has(`${key}#${nodeId}`)) continue;
            effects.push({
                kind: "put",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                source: { nodeId },
                reason: "AppStorage-Write",
            });
        }
    }

    for (const [key, nodeIds] of model.writeFieldNodeIdsByKey.entries()) {
        for (const nodeId of nodeIds) {
            effects.push({
                kind: "put",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                source: { nodeId },
                reason: "AppStorage-DecorFieldWrite",
            });
        }
    }

    for (const [key, endpoints] of model.writeFieldEndpointsByKey.entries()) {
        for (const endpoint of endpoints) {
            effects.push({
                kind: "put",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                source: {
                    nodeId: endpoint.objectNodeId,
                    fieldHead: endpoint.fieldName,
                },
                reason: "AppStorage-DecorFieldEndpointWrite",
            });
        }
    }

    for (const [key, operations] of model.readOperationsByKey.entries()) {
        for (const op of operations) {
            sequencedReadNodes.add(`${key}#${op.nodeId}`);
            effects.push({
                kind: "get",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                target: { nodeId: op.nodeId },
                reason: "AppStorage-Read",
                originModel: "harmony.appstorage",
                programPoint: appStorageProgramPoint(op),
                flowScope: op.methodSignature,
                sequence: appStorageOperationSequence(op),
                updateStrength: "strong",
                confidence: "certain",
            });
        }
    }

    for (const [key, nodeIds] of model.readNodeIdsByKey.entries()) {
        for (const nodeId of nodeIds) {
            if (sequencedReadNodes.has(`${key}#${nodeId}`)) continue;
            effects.push({
                kind: "get",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                target: { nodeId },
                reason: "AppStorage-Read",
            });
        }
    }

    for (const [key, nodeIds] of model.readFieldNodeIdsByKey.entries()) {
        for (const nodeId of nodeIds) {
            effects.push({
                kind: "get",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                target: { nodeId },
                reason: "AppStorage-DecorFieldNode",
            });
        }
    }

    for (const [key, endpoints] of model.readFieldEndpointsByKey.entries()) {
        for (const endpoint of endpoints) {
            effects.push({
                kind: "get",
                handle: createExactHandoffHandle(APPSTORAGE_CELL_KIND, APPSTORAGE_HANDOFF_FAMILY, key),
                target: {
                    nodeId: endpoint.objectNodeId,
                    fieldPath: [endpoint.fieldName],
                },
                reason: "AppStorage-Decor",
            });
        }
    }

    return effects;
}

function appStorageProgramPoint(op: AppStorageNodeOperation): string {
    return `${op.methodSignature}#${op.stmtIndex}:${op.callSignature || op.apiName}`;
}

function appStorageOperationSequence(op: AppStorageNodeOperation): number {
    return op.stmtIndex * 10 + (op.sequenceOffset || 0);
}

interface StorageKeyToken {
    keys: string[];
    dynamic: boolean;
    keyExprText: string;
}

export function buildAppStorageModel(
    args: BuildAppStorageModelArgs,
    options: BuildAppStorageInternalOptions = {
        writeSpecByCanonicalApiId: new Map(),
        writeResultSpecByCanonicalApiId: new Map(),
        readCanonicalApiIds: new Set(),
        killCanonicalApiIds: new Set(),
        propDecoratorCanonicalApiIds: new Set(),
        linkDecoratorCanonicalApiIds: new Set(),
    },
): AppStorageModel {
    const writeNodeIdsByKey = new Map<string, Set<number>>();
    const writeOperationsByKey = new Map<string, AppStorageNodeOperation[]>();
    const cleanOverwriteOperationsByKey = new Map<string, AppStorageNodeOperation[]>();
    const writeFieldNodeIdsByKey = new Map<string, Set<number>>();
    const writeFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readNodeIdsByKey = new Map<string, Set<number>>();
    const readOperationsByKey = new Map<string, AppStorageNodeOperation[]>();
    const killOperationsByKey = new Map<string, AppStorageNodeOperation[]>();
    const readFieldEndpointsByKey = new Map<string, AppStorageFieldEndpoint[]>();
    const readFieldNodeIdsByKey = new Map<string, Set<number>>();
    const warningByKey = new Map<string, AppStorageDynamicKeyWarning>();

    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    const methodBySignature = new Map<string, any>();
    const stmtIndexByStmt = new WeakMap<object, number>();
    for (const method of methods) {
        const methodSignature = method.getSignature?.()?.toString?.() || "";
        if (methodSignature) methodBySignature.set(methodSignature, method);
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const stmts = cfg.getStmts?.() || [];
        for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
            const stmt = stmts[stmtIndex];
            if (stmt && (typeof stmt === "object" || typeof stmt === "function")) {
                stmtIndexByStmt.set(stmt, stmtIndex);
            }
        }
    }
    const addWriteNodeId = (key: string, nodeId: number): void => {
        addMapSetValue(writeNodeIdsByKey, key, nodeId);
    };
    const addWriteOperation = (key: string, operation: AppStorageNodeOperation): void => {
        if (!writeOperationsByKey.has(key)) writeOperationsByKey.set(key, []);
        writeOperationsByKey.get(key)!.push(operation);
    };
    const addCleanOverwriteOperation = (key: string, operation: AppStorageNodeOperation): void => {
        if (!cleanOverwriteOperationsByKey.has(key)) cleanOverwriteOperationsByKey.set(key, []);
        cleanOverwriteOperationsByKey.get(key)!.push(operation);
    };
    const addReadNodeId = (key: string, nodeId: number): void => {
        addMapSetValue(readNodeIdsByKey, key, nodeId);
    };
    const addReadOperation = (key: string, operation: AppStorageNodeOperation): void => {
        if (!readOperationsByKey.has(key)) readOperationsByKey.set(key, []);
        readOperationsByKey.get(key)!.push(operation);
    };
    const addKillOperation = (key: string, operation: AppStorageNodeOperation): void => {
        if (!killOperationsByKey.has(key)) killOperationsByKey.set(key, []);
        killOperationsByKey.get(key)!.push(operation);
    };
    const addDynamicKeyWarning = (warning: AppStorageDynamicKeyWarning): void => {
        const k = `${warning.methodSignature}|${warning.callSignature}|${warning.keyExprText}`;
        if (warningByKey.has(k)) return;
        warningByKey.set(k, warning);
    };

    const storageCanonicalApiIds = new Set<string>([
        ...options.writeSpecByCanonicalApiId.keys(),
        ...options.writeResultSpecByCanonicalApiId.keys(),
        ...options.readCanonicalApiIds,
        ...options.killCanonicalApiIds,
    ]);
    const storageCalls = storageCanonicalApiIds.size > 0
        ? args.scan.invokes({ canonicalApiIds: [...storageCanonicalApiIds] })
        : [];
    for (const call of storageCalls) {
        const canonicalApiId = call.call.canonicalApiId || "";
        if (!canonicalApiId) continue;
        const methodSignature = call.ownerMethodSignature;
        const ownerMethod = methodBySignature.get(methodSignature);
        if (!ownerMethod) continue;
        const stmt = call.stmt;
        const stmtIndex = stmt && (typeof stmt === "object" || typeof stmt === "function")
            ? (stmtIndexByStmt.get(stmt) ?? 0)
            : 0;
        const invokeExpr = call.invokeExpr;
        const className = call.call.declaringClassName || "Storage";
        const apiName = call.call.methodName;
        const callSignature = call.call.signature;
        const invokeArgs = call.args();
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
            resolveStorageScopeTokens(args, ownerMethod, stmt, invokeExpr, className),
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

        const writeSpec = options.writeSpecByCanonicalApiId.get(canonicalApiId);
        if (writeSpec) {
            processKeyedStorageWriteSpec({
                args,
                call,
                scopedKeys,
                spec: writeSpec,
                methodSignature,
                stmtIndex,
                callSignature,
                apiName,
                invokeArgs,
                addWriteNodeId,
                addWriteOperation,
                addCleanOverwriteOperation,
            });
        }

        const writeResultSpec = options.writeResultSpecByCanonicalApiId.get(canonicalApiId);
        if (writeResultSpec) {
            processKeyedStorageWriteSpec({
                args,
                call,
                scopedKeys,
                spec: writeResultSpec,
                methodSignature,
                stmtIndex,
                callSignature,
                apiName,
                invokeArgs,
                addWriteNodeId,
                addWriteOperation,
                addCleanOverwriteOperation,
            });
            if (stmt instanceof ArkAssignStmt) {
                const readNodeIds = collectConsumableCallEndpointNodeIds(args, call, endpointReturnMatcher, { base: { kind: "return" } });
                for (const key of scopedKeys) {
                    for (const nodeId of readNodeIds) {
                        addReadNodeId(key, nodeId);
                        addReadOperation(key, {
                            nodeId,
                            methodSignature,
                            stmtIndex,
                            callSignature,
                            apiName,
                            sequenceOffset: 2,
                        });
                    }
                }
            }
        }

        if (options.readCanonicalApiIds.has(canonicalApiId)) {
            if (stmt instanceof ArkAssignStmt) {
                const readNodeIds = collectConsumableCallEndpointNodeIds(args, call, endpointReturnMatcher, { base: { kind: "return" } });
                for (const key of scopedKeys) {
                    for (const nodeId of readNodeIds) {
                        addReadNodeId(key, nodeId);
                        addReadOperation(key, {
                            nodeId,
                            methodSignature,
                            stmtIndex,
                            callSignature,
                            apiName,
                        });
                    }
                }
            }
        }

        if (options.killCanonicalApiIds.has(canonicalApiId)) {
            if (!hasResolvedCallEndpointValue(args, call, endpointArgMatcher(0), { base: { kind: "arg", index: 0 } })) {
                continue;
            }
            for (const key of scopedKeys) {
                addKillOperation(key, {
                    nodeId: -1,
                    methodSignature,
                    stmtIndex,
                    callSignature,
                    apiName,
                });
            }
        }
    }

    const propDecoratorStats = collectDecoratedStorageFields({
        args,
        methodBySignature,
        decoratorCanonicalApiIds: options.propDecoratorCanonicalApiIds,
        addReadNodeId: (key, nodeId) => addMapSetValue(readFieldNodeIdsByKey, key, nodeId),
        addReadEndpoint: (key, endpoint) => addUniqueFieldEndpoint(readFieldEndpointsByKey, key, endpoint),
    });
    const linkDecoratorStats = collectDecoratedStorageFields({
        args,
        methodBySignature,
        decoratorCanonicalApiIds: options.linkDecoratorCanonicalApiIds,
        addReadNodeId: (key, nodeId) => addMapSetValue(readFieldNodeIdsByKey, key, nodeId),
        addReadEndpoint: (key, endpoint) => addUniqueFieldEndpoint(readFieldEndpointsByKey, key, endpoint),
        addWriteNodeId: (key, nodeId) => addMapSetValue(writeFieldNodeIdsByKey, key, nodeId),
        addWriteEndpoint: (key, endpoint) => addUniqueFieldEndpoint(writeFieldEndpointsByKey, key, endpoint),
    });

    return {
        writeNodeIdsByKey,
        writeOperationsByKey,
        cleanOverwriteOperationsByKey,
        writeFieldNodeIdsByKey,
        writeFieldEndpointsByKey,
        readNodeIdsByKey,
        readOperationsByKey,
        killOperationsByKey,
        readFieldEndpointsByKey,
        readFieldNodeIdsByKey,
        dynamicKeyWarnings: [...warningByKey.values()],
        debug: {
            propDecoratorStats,
            linkDecoratorStats,
        },
    };
}

function processKeyedStorageWriteSpec(input: {
    args: BuildAppStorageModelArgs;
    call: ModuleScannedInvoke;
    scopedKeys: string[];
    spec: RuntimeWriteApiSpec;
    methodSignature: string;
    stmtIndex: number;
    callSignature: string;
    apiName: string;
    invokeArgs: any[];
    addWriteNodeId: (key: string, nodeId: number) => void;
    addWriteOperation: (key: string, operation: AppStorageNodeOperation) => void;
    addCleanOverwriteOperation: (key: string, operation: AppStorageNodeOperation) => void;
}): void {
    const { spec, invokeArgs } = input;
    if (invokeArgs.length <= spec.valueIndex) return;
    const valueArg = invokeArgs[spec.valueIndex];
    const updateStrength = spec.updateStrength || "strong";
    const valueEndpoint: AssetEndpoint = { base: { kind: "arg", index: spec.valueIndex } };
    const writeNodeIds = collectConsumableCallEndpointNodeIds(input.args, input.call, endpointArgMatcher(spec.valueIndex), valueEndpoint);
    if (writeNodeIds.length > 0) {
        for (const key of input.scopedKeys) {
            for (const nodeId of writeNodeIds) {
                input.addWriteNodeId(key, nodeId);
                input.addWriteOperation(key, {
                    nodeId,
                    methodSignature: input.methodSignature,
                    stmtIndex: input.stmtIndex,
                    callSignature: input.callSignature,
                    apiName: input.apiName,
                    updateStrength,
                });
            }
        }
        return;
    }
    if (
        updateStrength !== "weak"
        && isCleanStorageOverwriteValue(valueArg)
        && hasResolvedCallEndpointValue(input.args, input.call, endpointArgMatcher(spec.valueIndex), valueEndpoint)
    ) {
        for (const key of input.scopedKeys) {
            input.addCleanOverwriteOperation(key, {
                nodeId: -1,
                methodSignature: input.methodSignature,
                stmtIndex: input.stmtIndex,
                callSignature: input.callSignature,
                apiName: input.apiName,
                updateStrength,
            });
        }
    }
}

function endpointArgMatcher(index: number): (endpointSpec: any) => boolean {
    return (endpointSpec: any): boolean => {
        const base = endpointSpec?.base;
        return base?.kind === "arg" && Number(base.index) === index;
    };
}

function endpointReturnMatcher(endpointSpec: any): boolean {
    const base = endpointSpec?.base;
    return base?.kind === "return" || base?.kind === "constructorResult";
}

function collectConsumableCallEndpointNodeIds(
    args: BuildAppStorageModelArgs,
    call: ModuleScannedInvoke,
    matchesEndpoint: (endpointSpec: any) => boolean,
    declaredEndpoint?: AssetEndpoint,
): number[] {
    const out = new Set<number>();
    for (const semanticSite of moduleEndpointSites(call, matchesEndpoint, declaredEndpoint)) {
        const projection = args.analysis.projectEndpoint({
            semanticSite,
            endpointSpec: semanticSite.endpointSpec,
            stmt: call.stmt,
            invokeExpr: call.invokeExpr,
        });
        if (!isConsumableSemanticEndpointProjection(projection)) continue;
        for (const nodeId of projection.nodeIds || []) out.add(nodeId);
        for (const nodeId of projection.carrierNodeIds || []) out.add(nodeId);
    }
    return [...out.values()];
}

function hasResolvedCallEndpointValue(
    args: BuildAppStorageModelArgs,
    call: ModuleScannedInvoke,
    matchesEndpoint: (endpointSpec: any) => boolean,
    declaredEndpoint?: AssetEndpoint,
): boolean {
    for (const semanticSite of moduleEndpointSites(call, matchesEndpoint, declaredEndpoint)) {
        const projection = args.analysis.projectEndpoint({
            semanticSite,
            endpointSpec: semanticSite.endpointSpec,
            stmt: call.stmt,
            invokeExpr: call.invokeExpr,
        });
        if (isConsumableSemanticEndpointProjection(projection)) {
            return true;
        }
        if (projection.status !== "asset_endpoint_error" && projection.values.length > 0) {
            return true;
        }
    }
    return false;
}

function moduleEndpointSites(
    call: ModuleScannedInvoke,
    matchesEndpoint: (endpointSpec: any) => boolean,
    declaredEndpoint?: AssetEndpoint,
): SemanticEffectSite[] {
    const existing = (call.call.semanticEffectSites || [])
        .filter(semanticSite => semanticSite.capability === "module" && matchesEndpoint(semanticSite.endpointSpec));
    if (existing.length > 0) return existing;
    if (!declaredEndpoint || !matchesEndpoint(declaredEndpoint)) return [];
    return [declaredModuleEndpointSite(call, declaredEndpoint)];
}

function declaredModuleEndpointSite(call: ModuleScannedInvoke, endpoint: AssetEndpoint): SemanticEffectSite {
    const endpointKey = JSON.stringify(endpoint);
    return {
        effectSiteId: `declared-module-endpoint:${call.call.occurrenceId}:${endpointKey}`,
        occurrenceId: call.call.occurrenceId,
        rawOccurrenceId: call.call.rawOccurrenceId,
        canonicalApiId: call.call.canonicalApiId,
        capability: "module",
        effectAssetId: "declared-module-endpoint",
        endpointSpec: endpoint,
        endpointBindingRef: "declared",
    };
}

function collectDecoratedStorageFields(input: {
    args: BuildAppStorageModelArgs;
    methodBySignature: Map<string, any>;
    decoratorCanonicalApiIds: Set<string>;
    addReadNodeId: (key: string, nodeId: number) => void;
    addReadEndpoint: (key: string, endpoint: AppStorageFieldEndpoint) => void;
    addWriteNodeId?: (key: string, nodeId: number) => void;
    addWriteEndpoint?: (key: string, endpoint: AppStorageFieldEndpoint) => void;
}): {
    fields: number;
    keyedFields: number;
    loads: number;
    stores: number;
    readNodes: number;
    readEndpoints: number;
    writeNodes: number;
    writeEndpoints: number;
} {
    const stats = {
        fields: 0,
        keyedFields: 0,
        loads: 0,
        stores: 0,
        readNodes: 0,
        readEndpoints: 0,
        writeNodes: 0,
        writeEndpoints: 0,
    };
    if (input.decoratorCanonicalApiIds.size === 0) return stats;
    const fields = input.args.scan.decoratedFields({
        decoratorCanonicalApiIds: [...input.decoratorCanonicalApiIds],
    });
    stats.fields = fields.length;
    for (const field of fields) {
        const keys = storageKeysFromDecoratedField(field, input.decoratorCanonicalApiIds);
        if (keys.length === 0) continue;
        stats.keyedFields += 1;
        const fieldFilter = field.fieldSignature
            ? { fieldSignature: field.fieldSignature }
            : { declaringClassName: field.className, fieldName: field.fieldName };
        for (const load of input.args.scan.fieldLoads(fieldFilter)) {
            stats.loads += 1;
            for (const nodeId of load.resultNodeIds()) {
                for (const key of keys) {
                    input.addReadNodeId(key, nodeId);
                    stats.readNodes += 1;
                }
            }
            const ownerMethod = input.methodBySignature.get(load.ownerMethodSignature);
            const objectNodeIds = load.baseObjectNodeIds();
            if (objectNodeIds.length === 0 && ownerMethod) {
                for (const nodeId of collectObjectNodeIdsFromValueInMethod(input.args.pag, ownerMethod, load.base())) {
                    objectNodeIds.push(nodeId);
                }
            }
            for (const objectNodeId of objectNodeIds) {
                for (const key of keys) {
                    input.addReadEndpoint(key, { objectNodeId, fieldName: field.fieldName });
                    stats.readEndpoints += 1;
                }
            }
        }
        if (!input.addWriteNodeId && !input.addWriteEndpoint) continue;
        for (const store of input.args.scan.fieldStores(fieldFilter)) {
            stats.stores += 1;
            for (const nodeId of store.valueNodeIds()) {
                for (const key of keys) {
                    input.addWriteNodeId?.(key, nodeId);
                    stats.writeNodes += 1;
                }
            }
            const ownerMethod = input.methodBySignature.get(store.ownerMethodSignature);
            const objectNodeIds = store.baseObjectNodeIds();
            if (objectNodeIds.length === 0 && ownerMethod) {
                for (const nodeId of collectObjectNodeIdsFromValueInMethod(input.args.pag, ownerMethod, store.base())) {
                    objectNodeIds.push(nodeId);
                }
            }
            for (const objectNodeId of objectNodeIds) {
                for (const key of keys) {
                    input.addWriteEndpoint?.(key, { objectNodeId, fieldName: field.fieldName });
                    stats.writeEndpoints += 1;
                }
            }
        }
    }
    return stats;
}

function storageKeysFromDecoratedField(
    field: ReturnType<BuildAppStorageModelArgs["scan"]["decoratedFields"]>[number],
    canonicalApiIds: Set<string>,
): string[] {
    const keys = new Set<string>();
    for (const decorator of field.decorators()) {
        if (!decorator.canonicalApiId || !canonicalApiIds.has(decorator.canonicalApiId)) continue;
        for (const key of storageKeyCandidatesFromDecorator(decorator)) {
            keys.add(key);
        }
    }
    return [...keys.values()];
}

function storageKeyCandidatesFromDecorator(decorator: { param?: string; content?: string }): string[] {
    const out = new Set<string>();
    for (const raw of [decorator.param, decorator.content]) {
        const normalized = normalizeStorageKey(raw || "");
        if (normalized) out.add(normalized);
        for (const quoted of extractQuotedStorageLiterals(raw || "")) {
            out.add(quoted);
        }
    }
    return [...out.values()];
}

function addUniqueFieldEndpoint(
    map: Map<string, AppStorageFieldEndpoint[]>,
    key: string,
    endpoint: AppStorageFieldEndpoint,
): void {
    const endpoints = map.get(key) || [];
    if (!endpoints.some(item => item.objectNodeId === endpoint.objectNodeId && item.fieldName === endpoint.fieldName)) {
        endpoints.push(endpoint);
    }
    map.set(key, endpoints);
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
    }
    if (scopeTokens.size === 0) {
        scopeTokens.add(`class:${className}`);
    }
    return [...scopeTokens].map(token => `${className}::${token}`);
}


function isCleanStorageOverwriteValue(value: any): boolean {
    if (!value) return false;
    if (value instanceof Constant) return true;
    const rawText = String(value?.toString?.() || "").trim();
    if (!rawText) return false;
    if (/^["'`][\s\S]*["'`]$/.test(rawText)) return true;
    if (/^(true|false|null|undefined)$/i.test(rawText)) return true;
    if (/^-?\d+(?:\.\d+)?$/.test(rawText)) return true;
    return false;
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

export default harmonyAppStorageModule;

