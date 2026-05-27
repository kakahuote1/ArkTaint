import type { ModuleEmission, ModuleFactEvent } from "../contracts/ModuleContract";
import { OclfsSolver } from "../oclfs/OclfsSolver";
import type { CurrentnessCertificate, StateCell, StateEffect } from "../oclfs/OclfsTypes";
import {
    HandoffEffect,
    HandoffGetEffect,
    HandoffHandle,
    HandoffKillEffect,
    HandoffMayCompatibilityPolicy,
    HandoffPutEffect,
    HandoffScopedLinkEffect,
    compatibleHandoffHandles,
    handoffHandleKey,
} from "./SemanticHandoffTypes";

interface IndexedHandoffEffect<T extends HandoffEffect> {
    effect: T;
    order: number;
}

interface HandoffPropagationIndexes {
    putsByNodeId: Map<number, Array<IndexedHandoffEffect<HandoffPutEffect>>>;
    putsByFieldEndpoint: Map<string, Array<IndexedHandoffEffect<HandoffPutEffect>>>;
    gets: Array<IndexedHandoffEffect<HandoffGetEffect>>;
    kills: Array<IndexedHandoffEffect<HandoffKillEffect>>;
    links: Array<IndexedHandoffEffect<HandoffScopedLinkEffect>>;
}

export interface HandoffPropagationOptions {
    mayCompatibilityPolicy?: HandoffMayCompatibilityPolicy;
}

export class HandoffPropagationSession {
    private readonly indexes: HandoffPropagationIndexes;
    private readonly emittedStateKeys = new Set<string>();
    private readonly mayCompatibilityPolicy: HandoffMayCompatibilityPolicy;

    constructor(effects: readonly HandoffEffect[], options: HandoffPropagationOptions = {}) {
        this.indexes = buildIndexes(effects);
        this.mayCompatibilityPolicy = options.mayCompatibilityPolicy || "conservative";
    }

    emitForFact(event: ModuleFactEvent): ModuleEmission[] | undefined {
        const putEffects = this.resolvePutEffects(event);
        if (putEffects.length === 0) return undefined;

        const emissions = event.emit.collector();
        for (const put of putEffects) {
            const stateKey = this.buildStateKey(event, put);
            if (this.emittedStateKeys.has(stateKey)) continue;
            this.emittedStateKeys.add(stateKey);

            for (const get of this.resolveGetEffects(put)) {
                if (isSelfFieldEcho(event, get.effect)) continue;
                const certificate = this.evaluateCurrentness(event, put, get);
                if (!certificateAllowsEmission(certificate, this.mayCompatibilityPolicy)) continue;

                const targetFieldPath = resolveTargetFieldPath(event, get.effect);
                if (targetFieldPath === false) continue;
                const options = get.effect.target.allowUnreachableTarget
                    ? { allowUnreachableTarget: true }
                    : undefined;
                if (targetFieldPath && targetFieldPath.length > 0) {
                    emissions.push(withCurrentness(
                        event.emit.toField(get.effect.target.nodeId, targetFieldPath, get.effect.reason, options),
                        certificate,
                    ));
                } else if (get.effect.target.preserveSourceField === false) {
                    emissions.push(withCurrentness(
                        event.emit.toNode(get.effect.target.nodeId, get.effect.reason, options),
                        certificate,
                    ));
                } else {
                    emissions.push(withCurrentness(
                        event.emit.preserveToNode(get.effect.target.nodeId, get.effect.reason, options),
                        certificate,
                    ));
                }
            }
        }

        return emissions.done();
    }

    private resolvePutEffects(event: ModuleFactEvent): Array<IndexedHandoffEffect<HandoffPutEffect>> {
        const out: Array<IndexedHandoffEffect<HandoffPutEffect>> = [
            ...(this.indexes.putsByNodeId.get(event.current.nodeId) || []),
        ];
        const fieldHead = event.current.fieldHead();
        if (fieldHead) {
            out.push(...(this.indexes.putsByFieldEndpoint.get(`${event.current.nodeId}#${fieldHead}`) || [])
                .filter(({ effect }) => sourceEndpointMatchesCurrentField(event, effect)));
        }
        return deduplicatePutEffects(out);
    }

    private resolveGetEffects(
        put: IndexedHandoffEffect<HandoffPutEffect>,
    ): Array<IndexedHandoffEffect<HandoffGetEffect>> {
        const out: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
        const seen = new Set<string>();
        for (const get of this.indexes.gets) {
            if (isDefiniteReverseSameScope(put, get)) continue;
            const compatibility = this.resolveCompatibility(put.effect.handle, get.effect.handle);
            if (compatibility === "no") continue;
            if (compatibility === "may" && this.mayCompatibilityPolicy === "block") continue;
            const key = `${get.order}|${getEffectKey(get.effect)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(get);
        }
        return out;
    }

    private resolveCompatibility(left: HandoffHandle, right: HandoffHandle): "exact" | "may" | "no" {
        const direct = compatibleHandoffHandles(left, right);
        if (direct !== "no") return direct;
        let sawMay = false;
        for (const link of this.indexes.links) {
            const leftToLinkLeft = compatibleHandoffHandles(left, link.effect.left);
            const rightToLinkRight = compatibleHandoffHandles(right, link.effect.right);
            const leftToLinkRight = compatibleHandoffHandles(left, link.effect.right);
            const rightToLinkLeft = compatibleHandoffHandles(right, link.effect.left);
            if (isExactPair(leftToLinkLeft, rightToLinkRight) || isExactPair(leftToLinkRight, rightToLinkLeft)) {
                return "exact";
            }
            if (isMayPair(leftToLinkLeft, rightToLinkRight) || isMayPair(leftToLinkRight, rightToLinkLeft)) {
                sawMay = true;
            }
        }
        return sawMay ? "may" : "no";
    }

    private evaluateCurrentness(
        event: ModuleFactEvent,
        put: IndexedHandoffEffect<HandoffPutEffect>,
        get: IndexedHandoffEffect<HandoffGetEffect>,
    ) {
        const value = valueCellForEvent(event, put);
        const target = valueCellForGet(event, get);
        const producerCell = cellForHandle(put.effect.handle);
        const consumerCell = cellForConsumerHandle(put.effect.handle, get.effect.handle, this.resolveCompatibility(put.effect.handle, get.effect.handle));
        const label = event.current.source || put.effect.reason;
        const putSequence = normalizeOclfsSequence(put.order, 1);
        const getSequence = normalizeOclfsSequence(resolveConsumerOrder(put, get), 9);
        const effects: StateEffect[] = [
            {
                id: `handoff-source|${put.order}|${event.current.nodeId}`,
                kind: "source",
                target: value,
                label,
                programPoint: put.effect.programPoint || put.effect.reason,
                sequence: putSequence - 1,
                origin: put.effect.originModel || "semantic-handoff",
                confidence: normalizeConfidence(put.effect.confidence),
            },
            {
                id: `handoff-store|${put.order}|${handoffHandleKey(put.effect.handle)}`,
                kind: "store",
                location: producerCell,
                value,
                label,
                programPoint: put.effect.programPoint || put.effect.reason,
                sequence: putSequence,
                origin: put.effect.originModel || "semantic-handoff",
                confidence: normalizeConfidence(put.effect.confidence),
                updateStrength: put.effect.updateStrength || "strong",
            },
            ...this.currentnessKillsBetween(put, get),
            {
                id: `handoff-load|${get.order}|${handoffHandleKey(get.effect.handle)}`,
                kind: "load",
                location: consumerCell,
                target,
                label,
                programPoint: get.effect.programPoint || get.effect.reason,
                sequence: getSequence,
                origin: get.effect.originModel || "semantic-handoff",
                confidence: normalizeConfidence(get.effect.confidence),
            },
            {
                id: `handoff-sink|${get.order}|${get.effect.target.nodeId}`,
                kind: "sink",
                value: target,
                sinkId: get.effect.reason,
                label,
                programPoint: get.effect.programPoint || get.effect.reason,
                sequence: getSequence + 1,
                origin: get.effect.originModel || "semantic-handoff",
                confidence: normalizeConfidence(get.effect.confidence),
            },
        ];
        const result = new OclfsSolver({ conservativeMay: true }).solve(effects);
        return result.certificates.find(cert => cert.candidateFlow.consumerEffectId.startsWith("handoff-load"));
    }

    private currentnessKillsBetween(
        put: IndexedHandoffEffect<HandoffPutEffect>,
        get: IndexedHandoffEffect<HandoffGetEffect>,
    ): StateEffect[] {
        const out: StateEffect[] = [];
        if (!canCompareDefiniteFlow(put.effect, get.effect)) return out;
        for (const kill of this.indexes.kills) {
            if (!canCompareDefiniteFlow(put.effect, kill.effect)) continue;
            if (!canCompareDefiniteFlow(kill.effect, get.effect)) continue;
            if (kill.order <= put.order || kill.order >= get.order) continue;
            out.push({
                id: `handoff-kill|${kill.order}|${handoffHandleKey(kill.effect.handle)}`,
                kind: "kill",
                location: cellForHandle(kill.effect.handle),
                programPoint: kill.effect.programPoint || kill.effect.reason,
                sequence: normalizeOclfsSequence(kill.order, 5),
                origin: kill.effect.originModel || "semantic-handoff",
                confidence: normalizeConfidence(kill.effect.confidence),
                updateStrength: kill.effect.updateStrength || "strong",
            });
        }
        return out;
    }

    private buildStateKey(event: ModuleFactEvent, indexed: IndexedHandoffEffect<HandoffPutEffect>): string {
        const effect = indexed.effect;
        const field = event.current.field ? event.current.field.join(".") : "";
        return [
            handoffHandleKey(effect.handle),
            event.current.source,
            event.current.contextId,
            field,
            String(indexed.order),
        ].join("|");
    }
}

export function createHandoffPropagationSession(
    effects: readonly HandoffEffect[],
    options: HandoffPropagationOptions = {},
): HandoffPropagationSession {
    return new HandoffPropagationSession(effects, options);
}

function buildIndexes(effects: readonly HandoffEffect[]): HandoffPropagationIndexes {
    const putsByNodeId = new Map<number, Array<IndexedHandoffEffect<HandoffPutEffect>>>();
    const putsByFieldEndpoint = new Map<string, Array<IndexedHandoffEffect<HandoffPutEffect>>>();
    const gets: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
    const kills: Array<IndexedHandoffEffect<HandoffKillEffect>> = [];
    const links: Array<IndexedHandoffEffect<HandoffScopedLinkEffect>> = [];

    for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        const order = effect.sequence === undefined ? index : effect.sequence;
        if (effect.kind === "put") {
            const indexed: IndexedHandoffEffect<HandoffPutEffect> = { effect, order };
            const fieldHead = effect.source.fieldPathPrefix?.[0] || effect.source.fieldHead;
            if (fieldHead) {
                addToMap(putsByFieldEndpoint, `${effect.source.nodeId}#${fieldHead}`, indexed);
            } else {
                addToMap(putsByNodeId, effect.source.nodeId, indexed);
            }
        } else if (effect.kind === "get") {
            gets.push({ effect, order });
        } else if (effect.kind === "kill") {
            kills.push({ effect, order });
        } else if (effect.kind === "scoped-link") {
            links.push({ effect, order });
        }
    }

    return {
        putsByNodeId,
        putsByFieldEndpoint,
        gets,
        kills,
        links,
    };
}

function certificateAllowsEmission(
    certificate: CurrentnessCertificate | undefined,
    mayCompatibilityPolicy: HandoffMayCompatibilityPolicy,
): boolean {
    if (!certificate) return false;
    if (certificate.verdict === "live") return true;
    if (certificate.verdict === "may-live") return mayCompatibilityPolicy === "conservative";
    if (certificate.verdict === "unknown") return mayCompatibilityPolicy === "conservative";
    return false;
}

function withCurrentness(
    emissions: ModuleEmission[],
    certificate: CurrentnessCertificate,
): ModuleEmission[] {
    return emissions.map(emission => ({
        ...emission,
        currentnessCertificates: [
            ...(emission.currentnessCertificates || []),
            certificate,
        ],
    }));
}

function cellForHandle(handle: HandoffHandle): StateCell {
    const kind = handle.cellKind;
    return {
        id: [
            kind,
            handle.family,
            handle.scope || "",
            handle.owner || "",
            handle.key || "",
            handle.index === undefined ? "" : String(handle.index),
            handle.allocSite || "",
            handle.precision,
        ].join("|"),
        kind,
        scope: handle.scope || "",
        owner: [
            handle.family,
            handle.owner || "",
            handle.index === undefined ? "" : String(handle.index),
            handle.allocSite || "",
        ].join(":"),
        key: handle.key,
        allocSite: handle.allocSite,
        index: handle.index,
        precision: handle.precision,
    };
}

function cellForConsumerHandle(
    producerHandle: HandoffHandle,
    consumerHandle: HandoffHandle,
    compatibility: "exact" | "may" | "no",
): StateCell {
    if (compatibility === "exact" && compatibleHandoffHandles(producerHandle, consumerHandle) === "no") {
        return cellForHandle(producerHandle);
    }
    return cellForHandle(consumerHandle);
}

function valueCellForEvent(event: ModuleFactEvent, put: IndexedHandoffEffect<HandoffPutEffect>): StateCell {
    return {
        id: `value-version|handoff-source|${event.current.nodeId}|${event.current.contextId}|${put.order}`,
        kind: "value-version",
        scope: put.effect.flowScope || "",
        owner: `node:${event.current.nodeId}`,
        valueVersion: `${event.current.nodeId}#${event.current.contextId}#${put.order}`,
        precision: "exact",
    };
}

function valueCellForGet(event: ModuleFactEvent, get: IndexedHandoffEffect<HandoffGetEffect>): StateCell {
    return {
        id: `value-version|handoff-target|${get.effect.target.nodeId}|${event.current.contextId}|${get.order}`,
        kind: "value-version",
        scope: get.effect.flowScope || "",
        owner: `node:${get.effect.target.nodeId}`,
        valueVersion: `${get.effect.target.nodeId}#${event.current.contextId}#${get.order}`,
        precision: "exact",
    };
}

function resolveConsumerOrder(
    put: IndexedHandoffEffect<HandoffPutEffect>,
    get: IndexedHandoffEffect<HandoffGetEffect>,
): number {
    if (canCompareDefiniteFlow(put.effect, get.effect)) return get.order;
    if (get.order > put.order) return get.order;
    return put.order + 1;
}

function normalizeOclfsSequence(order: number, offset: number): number {
    return order * 10 + offset;
}

function normalizeConfidence(confidence: HandoffEffect["confidence"]): "certain" | "likely" | "unknown" {
    return confidence || "certain";
}

function addToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const bucket = map.get(key) || [];
    if (!map.has(key)) map.set(key, bucket);
    bucket.push(value);
}

function isExactPair(left: "exact" | "may" | "no", right: "exact" | "may" | "no"): boolean {
    return left === "exact" && right === "exact";
}

function isMayPair(left: "exact" | "may" | "no", right: "exact" | "may" | "no"): boolean {
    return left !== "no" && right !== "no" && (left === "may" || right === "may");
}

function isDefiniteReverseSameScope(
    put: IndexedHandoffEffect<HandoffPutEffect>,
    get: IndexedHandoffEffect<HandoffGetEffect>,
): boolean {
    return canCompareDefiniteFlow(put.effect, get.effect) && get.order < put.order;
}

function canCompareDefiniteFlow(
    left: Pick<HandoffEffect, "flowScope">,
    right: Pick<HandoffEffect, "flowScope">,
): boolean {
    return Boolean(left.flowScope && right.flowScope && left.flowScope === right.flowScope);
}

function deduplicatePutEffects(
    effects: Array<IndexedHandoffEffect<HandoffPutEffect>>,
): Array<IndexedHandoffEffect<HandoffPutEffect>> {
    const out: Array<IndexedHandoffEffect<HandoffPutEffect>> = [];
    const seen = new Set<string>();
    for (const indexed of effects) {
        const effect = indexed.effect;
        const key = [
            indexed.order,
            handoffHandleKey(effect.handle),
            effect.source.nodeId,
            effect.source.fieldHead || "",
            effect.source.fieldPathPrefix?.join(".") || "",
            effect.reason,
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(indexed);
    }
    return out;
}

function getEffectKey(effect: HandoffGetEffect): string {
    const field = effect.target.fieldPath ? effect.target.fieldPath.join(".") : "";
    const current = effect.target.currentField
        ? [
            effect.target.currentField.mode,
            effect.target.currentField.prefix?.join(".") || "",
            effect.target.currentField.unwrapPrefixes?.join(".") || "",
            effect.target.currentField.stripPrefixes?.map(prefix => prefix.join(".")).join(",") || "",
            effect.target.currentField.requireField ? "require" : "",
            effect.target.preserveSourceField === false ? "drop" : "",
        ].join("/")
        : "";
    return [
        handoffHandleKey(effect.handle),
        effect.target.nodeId,
        field,
        current,
        effect.reason,
    ].join("|");
}

function resolveTargetFieldPath(
    event: ModuleFactEvent,
    effect: HandoffGetEffect,
): string[] | undefined | false {
    if (effect.target.fieldPath) {
        return effect.target.fieldPath;
    }
    const mapping = effect.target.currentField;
    if (!mapping) {
        return undefined;
    }
    let current = event.current.cloneField?.();
    if (mapping.requireField && (!current || current.length === 0)) {
        return false;
    }
    current = stripFieldPathPrefixes(current, mapping.stripPrefixes);

    let fieldPath: string[] | undefined;
    if (mapping.mode === "preserve") {
        fieldPath = current;
    } else if (mapping.mode === "tail") {
        fieldPath = event.current.fieldTail?.();
    } else if (mapping.mode === "prefix") {
        const prefix = mapping.prefix || [];
        fieldPath = current && current.length > 0
            ? [...prefix, ...current]
            : [...prefix];
    } else {
        const prefix = mapping.prefix || [];
        const tail = event.current.fieldTail?.();
        fieldPath = tail && tail.length > 0
            ? [...prefix, ...tail]
            : [...prefix];
    }

    fieldPath = unwrapFieldPath(fieldPath, mapping.unwrapPrefixes);
    return fieldPath && fieldPath.length > 0 ? fieldPath : undefined;
}

function unwrapFieldPath(
    fieldPath?: string[],
    unwrapPrefixes?: string[],
): string[] | undefined {
    if (!fieldPath || fieldPath.length === 0) return undefined;
    if (!unwrapPrefixes || unwrapPrefixes.length === 0) return fieldPath;
    const [head, ...tail] = fieldPath;
    if (!unwrapPrefixes.includes(head)) return fieldPath;
    return tail.length > 0 ? tail : undefined;
}

function stripFieldPathPrefixes(
    fieldPath?: string[],
    prefixes?: string[][],
): string[] | undefined {
    if (!fieldPath || fieldPath.length === 0 || !prefixes || prefixes.length === 0) {
        return fieldPath;
    }
    let best: string[] | undefined;
    for (const prefix of prefixes) {
        if (!startsWithFieldPath(fieldPath, prefix)) continue;
        if (!best || prefix.length > best.length) {
            best = prefix;
        }
    }
    return best ? fieldPath.slice(best.length) : fieldPath;
}

function sourceEndpointMatchesCurrentField(event: ModuleFactEvent, effect: HandoffPutEffect): boolean {
    const prefix = effect.source.fieldPathPrefix;
    if (!prefix || prefix.length === 0) return true;
    return startsWithFieldPath(event.current.cloneField?.(), prefix);
}

function startsWithFieldPath(fieldPath: string[] | undefined, prefix: string[]): boolean {
    if (!fieldPath || fieldPath.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (fieldPath[i] !== prefix[i]) return false;
    }
    return true;
}

function isSelfFieldEcho(event: ModuleFactEvent, effect: HandoffGetEffect): boolean {
    const fieldHead = event.current.fieldHead();
    if (!fieldHead || event.current.nodeId !== effect.target.nodeId) return false;
    const targetFieldPath = resolveTargetFieldPath(event, effect);
    return Array.isArray(targetFieldPath) && targetFieldPath[0] === fieldHead;
}
