import type { ModuleEmission, ModuleFactEvent } from "../contracts/ModuleContract";
import {
    compatibleHandoffHandles,
    HandoffEffect,
    HandoffGetEffect,
    HandoffHandle,
    HandoffKillEffect,
    HandoffMayCompatibilityPolicy,
    HandoffPutEffect,
    HandoffScopedLinkEffect,
    handoffHandleKey,
} from "./SemanticHandoffTypes";

interface IndexedHandoffEffect<T extends HandoffEffect> {
    effect: T;
    order: number;
}

interface HandoffPropagationIndexes {
    putsByNodeId: Map<number, Array<IndexedHandoffEffect<HandoffPutEffect>>>;
    putsByFieldEndpoint: Map<string, Array<IndexedHandoffEffect<HandoffPutEffect>>>;
    getsByHandleKey: Map<string, Array<IndexedHandoffEffect<HandoffGetEffect>>>;
    exactLinksByHandleKey: Map<string, Set<string>>;
    gets: Array<IndexedHandoffEffect<HandoffGetEffect>>;
    kills: Array<IndexedHandoffEffect<HandoffKillEffect>>;
    links: Array<IndexedHandoffEffect<HandoffScopedLinkEffect>>;
    hasNonExactHandles: boolean;
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
                const targetFieldPath = resolveTargetFieldPath(event, get.effect);
                if (targetFieldPath === false) continue;
                const options = get.effect.target.allowUnreachableTarget
                    ? { allowUnreachableTarget: true }
                    : undefined;
                if (targetFieldPath && targetFieldPath.length > 0) {
                    emissions.push(event.emit.toField(get.effect.target.nodeId, targetFieldPath, get.effect.reason, options));
                } else if (get.effect.target.preserveSourceField === false) {
                    emissions.push(event.emit.toNode(get.effect.target.nodeId, get.effect.reason, options));
                } else {
                    emissions.push(event.emit.preserveToNode(get.effect.target.nodeId, get.effect.reason, options));
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
        if (put.effect.handle.precision === "exact" && !this.indexes.hasNonExactHandles) {
            return this.resolveExactGetEffects(put);
        }
        const out: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
        const seen = new Set<string>();
        for (const get of this.indexes.gets) {
            if (isDefiniteReverseSameScope(put, get)) continue;
            const compatibility = this.resolveCompatibility(put.effect.handle, get.effect.handle);
            if (compatibility === "no") continue;
            if (compatibility === "may" && this.mayCompatibilityPolicy === "block") continue;
            if (this.isKilledBetween(put, get)) continue;
            const key = `${get.order}|${getEffectKey(get.effect)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(get);
        }
        return out;
    }

    private resolveExactGetEffects(
        put: IndexedHandoffEffect<HandoffPutEffect>,
    ): Array<IndexedHandoffEffect<HandoffGetEffect>> {
        const handleKey = handoffHandleKey(put.effect.handle);
        const candidateKeys = new Set<string>([handleKey]);
        for (const linked of this.indexes.exactLinksByHandleKey.get(handleKey) || []) {
            candidateKeys.add(linked);
        }
        const candidates: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
        for (const key of candidateKeys) {
            candidates.push(...(this.indexes.getsByHandleKey.get(key) || []));
        }
        const out: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
        const seen = new Set<string>();
        for (const get of candidates) {
            if (isDefiniteReverseSameScope(put, get)) continue;
            if (this.isKilledBetween(put, get)) continue;
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

    private isKilledBetween(
        put: IndexedHandoffEffect<HandoffPutEffect>,
        get: IndexedHandoffEffect<HandoffGetEffect>,
    ): boolean {
        if (!canCompareDefiniteFlow(put.effect, get.effect)) return false;
        for (const kill of this.indexes.kills) {
            if (!canCompareDefiniteFlow(put.effect, kill.effect)) continue;
            if (!canCompareDefiniteFlow(kill.effect, get.effect)) continue;
            if (kill.order <= put.order || kill.order >= get.order) continue;
            if ((kill.effect.updateStrength || "strong") !== "strong") continue;
            if (kill.effect.handle.precision !== "exact") continue;
            if (this.resolveCompatibility(put.effect.handle, kill.effect.handle) !== "exact") continue;
            return true;
        }
        return false;
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
    const getsByHandleKey = new Map<string, Array<IndexedHandoffEffect<HandoffGetEffect>>>();
    const exactLinksByHandleKey = new Map<string, Set<string>>();
    const gets: Array<IndexedHandoffEffect<HandoffGetEffect>> = [];
    const kills: Array<IndexedHandoffEffect<HandoffKillEffect>> = [];
    const links: Array<IndexedHandoffEffect<HandoffScopedLinkEffect>> = [];
    let hasNonExactHandles = false;

    for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        if (effectHasNonExactHandle(effect)) {
            hasNonExactHandles = true;
        }
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
            const indexed: IndexedHandoffEffect<HandoffGetEffect> = { effect, order };
            gets.push(indexed);
            addToMap(getsByHandleKey, handoffHandleKey(effect.handle), indexed);
        } else if (effect.kind === "kill") {
            const indexed: IndexedHandoffEffect<HandoffKillEffect> = { effect, order };
            kills.push(indexed);
        } else if (effect.kind === "scoped-link") {
            const indexed: IndexedHandoffEffect<HandoffScopedLinkEffect> = { effect, order };
            links.push(indexed);
            if (effect.left.precision === "exact" && effect.right.precision === "exact") {
                addLinkedHandleKey(exactLinksByHandleKey, handoffHandleKey(effect.left), handoffHandleKey(effect.right));
                addLinkedHandleKey(exactLinksByHandleKey, handoffHandleKey(effect.right), handoffHandleKey(effect.left));
            }
        }
    }

    return {
        putsByNodeId,
        putsByFieldEndpoint,
        getsByHandleKey,
        exactLinksByHandleKey,
        gets,
        kills,
        links,
        hasNonExactHandles,
    };
}

function addToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const bucket = map.get(key) || [];
    if (!map.has(key)) map.set(key, bucket);
    bucket.push(value);
}

function addLinkedHandleKey(map: Map<string, Set<string>>, left: string, right: string): void {
    const bucket = map.get(left) || new Set<string>();
    if (!map.has(left)) map.set(left, bucket);
    bucket.add(right);
}

function effectHasNonExactHandle(effect: HandoffEffect): boolean {
    if (effect.kind === "scoped-link") {
        return effect.left.precision !== "exact" || effect.right.precision !== "exact";
    }
    return effect.handle.precision !== "exact";
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
