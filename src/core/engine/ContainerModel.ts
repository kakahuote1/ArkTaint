import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkNormalBinopExpr, ArkInstanceInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";

export interface ContainerSlotStoreInfo {
    objId: number;
    slot: string;
}

const SLOT_PREFIX = "$c$:";

export function toContainerFieldKey(slot: string): string {
    return `${SLOT_PREFIX}${slot}`;
}

export function fromContainerFieldKey(field: string): string | null {
    if (!field.startsWith(SLOT_PREFIX)) return null;
    return field.slice(SLOT_PREFIX.length);
}

export function collectContainerSlotStoresFromTaintedLocal(local: Local, pag: Pag): ContainerSlotStoreInfo[] {
    const results: ContainerSlotStoreInfo[] = [];
    const dedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (left instanceof ArkArrayRef && right === local) {
                const base = left.getBase();
                const idxKey = resolveValueKey(left.getIndex());
                if (idxKey !== undefined) {
                    for (const objId of resolveBaseObjIds(base, pag)) {
                        const slot = `arr:${idxKey}`;
                        const key = `${objId}|${slot}`;
                        if (dedup.has(key)) continue;
                        dedup.add(key);
                        results.push({ objId, slot });
                    }
                }
            }
        }

        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

        const base = invokeExpr.getBase();
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";

        if (methodName === "set" && args.length >= 2 && args[1] === local) {
            const key = resolveValueKey(args[0]);
            if (key !== undefined) {
                for (const objId of resolveBaseObjIds(base, pag)) {
                    const slot = `map:${key}`;
                    const dedupKey = `${objId}|${slot}`;
                    if (dedup.has(dedupKey)) continue;
                    dedup.add(dedupKey);
                    results.push({ objId, slot });
                }
            }
        }

        if ((methodName === "add" || methodName === "append" || methodName === "push") && args.length >= 1 && args[0] === local) {
            const ordinal = resolveAddOrdinal(base, stmt);
            if (ordinal < 0) continue;
            let slot: string | null = null;
            if (sig.includes("List.")) slot = `list:${ordinal}`;
            if (sig.includes("Queue.")) slot = `queue:${ordinal}`;
            if (sig.includes("Array.")) slot = `arr:${ordinal}`;
            if (!slot) continue;

            for (const objId of resolveBaseObjIds(base, pag)) {
                const dedupKey = `${objId}|${slot}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                results.push({ objId, slot });
            }
        }
    }

    return results;
}

export function collectContainerSlotLoadNodeIds(objId: number, slot: string, pag: Pag, scene: Scene): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

        for (const stmt of val.getUsedStmts()) {
            if (stmt instanceof ArkAssignStmt) {
                const right = stmt.getRightOp();
                const left = stmt.getLeftOp();

                if (right instanceof ArkArrayRef && right.getBase() === val) {
                    // Array load remains handled by existing PAG/copy propagation for now.
                    // Keep ContainerModel array slots for future precise path matching.
                    continue;
                }

                if (right instanceof ArkInstanceInvokeExpr && right.getBase() === val) {
                    const methodName = resolveMethodName(right);
                    const sig = right.getMethodSignature()?.toString() || "";
                    const args = right.getArgs ? right.getArgs() : [];

                    let matched = false;
                    if (methodName === "get" && sig.includes("Map.")) {
                        const key = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                        matched = key !== undefined && slot === `map:${key}`;
                    } else if (methodName === "get" && sig.includes("List.")) {
                        const idxKey = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                        matched = idxKey !== undefined && slot === `list:${idxKey}`;
                    } else if (methodName === "getFirst" && sig.includes("Queue.")) {
                        matched = slot === "queue:0";
                    } else if (methodName === "toString" && slot.startsWith("arr:")) {
                        matched = true;
                    } else if (methodName === "shift" && slot === "arr:0") {
                        matched = true;
                    } else if (methodName === "pop" && slot.startsWith("arr:")) {
                        matched = isLikelyArrayPopSourceSlot(slot, val);
                    }

                    if (matched) {
                        const dst = pag.getNodesByValue(left);
                        if (!dst) continue;
                        for (const id of dst.values()) {
                            if (dedup.has(id)) continue;
                            dedup.add(id);
                            results.push(id);
                        }
                    }
                }

                if (right instanceof ArkInstanceInvokeExpr) {
                    const methodName = resolveMethodName(right);
                    const args = right.getArgs ? right.getArgs() : [];
                    if (methodName === "concat" && slot.startsWith("arr:") && args.includes(val)) {
                        const dst = pag.getNodesByValue(left);
                        if (!dst) continue;
                        for (const id of dst.values()) {
                            if (dedup.has(id)) continue;
                            dedup.add(id);
                            results.push(id);
                        }
                    }
                }
            }

            if (stmt instanceof ArkInvokeStmt) {
                const invokeExpr = stmt.getInvokeExpr();
                if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
                if (invokeExpr.getBase() !== val) continue;
                const methodName = resolveMethodName(invokeExpr);
                if (methodName !== "forEach") continue;
                if (!slot.startsWith("arr:")) continue;
                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                if (args.length === 0) continue;

                const callbackParamNodeIds = collectCallbackParamNodeIds(scene, pag, args[0]);
                for (const nodeId of callbackParamNodeIds) {
                    if (dedup.has(nodeId)) continue;
                    dedup.add(nodeId);
                    results.push(nodeId);
                }
            }
        }
    }

    return results;
}

export function collectPreciseArrayLoadNodeIdsFromTaintedLocal(local: Local, pag: Pag): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || right !== local) continue;

        const sourceIdx = resolveValueKey(left.getIndex());
        if (sourceIdx === undefined) continue;
        const sourcePaths = collectArrayElementPathKeys(left.getBase(), sourceIdx);
        if (sourcePaths.size === 0) continue;

        for (const rawNode of pag.getNodesIter()) {
            const node = rawNode as PagNode;
            const val = node.getValue();
            if (!(val instanceof Local)) continue;

            const decl = val.getDeclaringStmt();
            if (!(decl instanceof ArkAssignStmt)) continue;
            if (decl.getLeftOp() !== val) continue;

            const loadRef = decl.getRightOp();
            if (!(loadRef instanceof ArkArrayRef)) continue;
            const loadIdx = resolveValueKey(loadRef.getIndex());
            if (loadIdx === undefined) continue;

            const loadPaths = collectArrayElementPathKeys(loadRef.getBase(), loadIdx);
            if (!hasPathIntersection(sourcePaths, loadPaths)) continue;

            const dstNodes = pag.getNodesByValue(val);
            if (!dstNodes) continue;
            for (const dstId of dstNodes.values()) {
                if (dedup.has(dstId)) continue;
                dedup.add(dstId);
                results.push(dstId);
            }
        }
    }

    return results;
}

function resolveBaseObjIds(base: Local, pag: Pag): number[] {
    const ids: number[] = [];
    const baseNodes = pag.getNodesByValue(base);
    if (!baseNodes) return ids;
    for (const baseNodeId of baseNodes.values()) {
        const baseNode = pag.getNode(baseNodeId) as PagNode;
        for (const objId of baseNode.getPointTo()) {
            ids.push(objId);
        }
    }
    return ids;
}

function collectArrayElementPathKeys(base: Local, idxKey: string): Set<string> {
    const keys = new Set<string>();
    for (const p of collectArrayObjectPathKeys(base, new Set<Local>())) {
        keys.add(`${p}/${idxKey}`);
    }
    return keys;
}

function collectArrayObjectPathKeys(local: Local, visiting: Set<Local>): Set<string> {
    if (visiting.has(local)) {
        return new Set([rootPathKey(local)]);
    }
    visiting.add(local);

    const keys = new Set<string>();
    const decl = local.getDeclaringStmt();

    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            mergePathKeys(keys, collectArrayObjectPathKeys(right, visiting));
        } else if (right instanceof ArkArrayRef) {
            const idx = resolveValueKey(right.getIndex());
            if (idx !== undefined) {
                for (const p of collectArrayObjectPathKeys(right.getBase(), visiting)) {
                    keys.add(`${p}/${idx}`);
                }
            }
        } else {
            keys.add(rootPathKey(local));
        }
    } else {
        keys.add(rootPathKey(local));
    }

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (right !== local) continue;

        const parentIdx = resolveValueKey(left.getIndex());
        if (parentIdx === undefined) continue;
        for (const p of collectArrayObjectPathKeys(left.getBase(), visiting)) {
            keys.add(`${p}/${parentIdx}`);
        }
    }

    visiting.delete(local);
    return keys;
}

function mergePathKeys(target: Set<string>, src: Set<string>): void {
    for (const k of src) target.add(k);
}

function rootPathKey(local: Local): string {
    const line = local.getDeclaringStmt()?.getOriginPositionInfo()?.getLineNo?.() ?? -1;
    return `${local.getName()}@${line}`;
}

function hasPathIntersection(a: Set<string>, b: Set<string>): boolean {
    for (const k of a) {
        if (b.has(k)) return true;
    }
    return false;
}

function resolveMethodName(invokeExpr: ArkInstanceInvokeExpr): string {
    const fromSig = invokeExpr.getMethodSignature()?.getMethodSubSignature()?.getMethodName() || "";
    if (fromSig) return fromSig;
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    const m = sig.match(/\.([A-Za-z0-9_]+)\(\)/);
    return m ? m[1] : "";
}

function collectCallbackParamNodeIds(scene: Scene, pag: Pag, callbackArg: any): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();
    const methodNames = resolveCallbackMethodNames(callbackArg);

    for (const method of scene.getMethods()) {
        if (!methodNames.has(method.getName())) continue;
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
            let dst = pag.getNodesByValue(stmt.getLeftOp());
            if (!dst || dst.size === 0) {
                dst = pag.getNodesByValue(stmt.getRightOp());
            }
            if (!dst || dst.size === 0) continue;
            for (const nodeId of dst.values()) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }

    return results;
}

function resolveCallbackMethodNames(callbackArg: any): Set<string> {
    const names = new Set<string>();
    if (callbackArg instanceof Local) {
        names.add(callbackArg.getName());
    }
    const text = callbackArg?.toString?.() || "";
    if (text) names.add(text);
    return names;
}

function isLikelyArrayPopSourceSlot(slot: string, base: Local): boolean {
    const slotIndex = parseArraySlotIndex(slot);
    if (slotIndex === undefined) return false;
    const maxIndex = resolveArrayMaxStoredIndex(base, new Set<Local>());
    if (maxIndex === undefined) {
        return true;
    }
    return slotIndex === maxIndex;
}

function parseArraySlotIndex(slot: string): number | undefined {
    const m = slot.match(/^arr:(-?\d+)$/);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
}

function resolveArrayMaxStoredIndex(local: Local, visiting: Set<Local>): number | undefined {
    if (visiting.has(local)) return undefined;
    visiting.add(local);

    let maxIndex: number | undefined = undefined;

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (left.getBase() !== local) continue;
        const idxKey = resolveValueKey(left.getIndex());
        if (idxKey === undefined) continue;
        const idxNum = Number(idxKey);
        if (!Number.isFinite(idxNum)) continue;
        maxIndex = maxIndex === undefined ? idxNum : Math.max(maxIndex, idxNum);
    }

    const decl = local.getDeclaringStmt();
    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            const rhsMax = resolveArrayMaxStoredIndex(right, visiting);
            if (rhsMax !== undefined) {
                maxIndex = maxIndex === undefined ? rhsMax : Math.max(maxIndex, rhsMax);
            }
        }
    }

    visiting.delete(local);
    return maxIndex;
}

function resolveAddOrdinal(base: Local, targetStmt: any): number {
    const stmts = [...base.getUsedStmts()].sort(
        (a: any, b: any) => a.getOriginPositionInfo().getLineNo() - b.getOriginPositionInfo().getLineNo()
    );
    let idx = 0;
    for (const stmt of stmts) {
        if (stmt === targetStmt) return idx;
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (invokeExpr.getBase() !== base) continue;
        const methodName = resolveMethodName(invokeExpr);
        if (methodName === "add" || methodName === "append" || methodName === "push") {
            idx++;
        }
    }
    return -1;
}

function resolveValueKey(v: any): string | undefined {
    if (v instanceof Constant) {
        return normalizeLiteral(v.toString());
    }

    if (v instanceof Local) {
        const decl = v.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt) {
            const right = decl.getRightOp();
            if (right instanceof Constant) {
                return normalizeLiteral(right.toString());
            }
            if (right instanceof ArkNormalBinopExpr) {
                const n1 = resolveNumber(right.getOp1());
                const n2 = resolveNumber(right.getOp2());
                if (n1 !== undefined && n2 !== undefined) {
                    const op = right.getOperator();
                    if (op === "+") return String(n1 + n2);
                    if (op === "-") return String(n1 - n2);
                    if (op === "*") return String(n1 * n2);
                    if (op === "/" && n2 !== 0) return String(n1 / n2);
                }
            }
        }
        return v.getName();
    }

    return undefined;
}

function resolveNumber(v: any): number | undefined {
    if (v instanceof Constant) {
        const t = normalizeLiteral(v.toString());
        const n = Number(t);
        if (!Number.isNaN(n)) return n;
    }
    if (v instanceof Local) {
        const key = resolveValueKey(v);
        const n = key !== undefined ? Number(key) : NaN;
        if (!Number.isNaN(n)) return n;
    }
    return undefined;
}

function normalizeLiteral(text: string): string {
    return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}
