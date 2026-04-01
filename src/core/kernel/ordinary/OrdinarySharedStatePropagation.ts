import { Pag, PagNode, PagStaticFieldNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ModelUtils } from "../../../../arkanalyzer/out/src/core/common/ModelUtils";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { TaintFact } from "../model/TaintFact";

export interface OrdinarySharedStateIndex {
    moduleStateNamesByFile: Map<string, Set<string>>;
    moduleStateConsumerNodeIdsByKey: Map<string, Set<number>>;
    moduleImportBindingConsumerNodeIdsByKey: Map<string, Set<number>>;
    staticFieldConsumerNodeIdsByKey: Map<string, Set<number>>;
}

export function buildOrdinarySharedStateIndex(
    scene: Scene,
    pag: Pag,
): OrdinarySharedStateIndex {
    const moduleStateNamesByFile = collectModuleStateNames(scene);
    const moduleImportBindingConsumerNodeIdsByKey = collectModuleImportBindingConsumerNodeIds(scene, pag, moduleStateNamesByFile);
    const moduleStateConsumerNodeIdsByKey = collectModuleStateConsumerNodeIds(pag, moduleStateNamesByFile);
    const staticFieldConsumerNodeIdsByKey = collectStaticFieldConsumerNodeIds(pag);
    return {
        moduleStateNamesByFile,
        moduleStateConsumerNodeIdsByKey,
        moduleImportBindingConsumerNodeIdsByKey,
        staticFieldConsumerNodeIdsByKey,
    };
}

export function collectOrdinaryModuleStateFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    contextId: number,
    pag: Pag,
    index: OrdinarySharedStateIndex,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const filePath = extractFilePathFromStmt(stmt);
        if (!filePath) continue;
        const moduleStateNames = index.moduleStateNamesByFile.get(filePath);
        if (!moduleStateNames?.has(left.getName())) continue;

        const consumerNodeIds = index.moduleStateConsumerNodeIdsByKey.get(toModuleStateKey(filePath, left.getName()));
        if (!consumerNodeIds || consumerNodeIds.size === 0) continue;
        for (const nodeId of consumerNodeIds.values()) {
            const targetNode = pag.getNode(nodeId) as PagNode;
            if (!targetNode) continue;
            results.push(new TaintFact(
                targetNode,
                source,
                contextId,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryModuleImportBindingFactsFromTaintedLocal(
    taintedNode: PagNode,
    source: string,
    currentContextId: number,
    sharedContextId: number,
    pag: Pag,
    index: OrdinarySharedStateIndex,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return results;

    for (const stmt of collectCandidateAssignStmts(value, taintedNode)) {
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof Local)) continue;
        if (!isSameLocal(right, value)) continue;

        const filePath = extractFilePathFromStmt(stmt);
        if (!filePath) continue;
        const moduleStateNames = index.moduleStateNamesByFile.get(filePath);
        if (!moduleStateNames?.has(left.getName())) continue;

        const consumerNodeIds = index.moduleImportBindingConsumerNodeIdsByKey.get(toModuleStateKey(filePath, left.getName()));
        if (!consumerNodeIds || consumerNodeIds.size === 0) continue;
        for (const nodeId of consumerNodeIds.values()) {
            const targetNode = pag.getNode(nodeId) as PagNode;
            if (!targetNode) continue;
            results.push(new TaintFact(
                targetNode,
                source,
                sharedContextId,
                fieldPath ? [...fieldPath] : undefined,
            ));
            if (currentContextId !== sharedContextId) {
                results.push(new TaintFact(
                    targetNode,
                    source,
                    currentContextId,
                    fieldPath ? [...fieldPath] : undefined,
                ));
            }
        }
    }

    return dedupFacts(results);
}

export function collectOrdinaryStaticSharedStateFactsFromTaintedNode(
    taintedNode: PagNode,
    source: string,
    contextId: number,
    pag: Pag,
    index: OrdinarySharedStateIndex,
    fieldPath?: string[],
): TaintFact[] {
    if (!(taintedNode instanceof PagStaticFieldNode)) return [];
    const key = taintedNode.getValue?.()?.toString?.() || "";
    if (!key) return [];

    const consumerNodeIds = index.staticFieldConsumerNodeIdsByKey.get(key);
    if (!consumerNodeIds || consumerNodeIds.size === 0) return [];

    const results: TaintFact[] = [];
    for (const nodeId of consumerNodeIds.values()) {
        if (nodeId === taintedNode.getID()) continue;
        const targetNode = pag.getNode(nodeId) as PagNode;
        if (!targetNode) continue;
        results.push(new TaintFact(
            targetNode,
            source,
            contextId,
            fieldPath ? [...fieldPath] : undefined,
        ));
    }
    return dedupFacts(results);
}

function collectModuleStateNames(scene: Scene): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.().toString?.() || "";
        if (!methodSig.includes("%dflt.[static]%dflt()")) continue;

        const filePath = extractFilePathFromMethodSignature(methodSig);
        if (!filePath) continue;
        if (!out.has(filePath)) out.set(filePath, new Set<string>());
        const names = out.get(filePath)!;

        const body = method.getBody?.();
        if (!body) continue;
        for (const local of body.getLocals().values()) {
            const name = local.getName?.() || "";
            if (!name || name === "this" || name.startsWith("%")) continue;
            names.add(name);
        }
    }
    return out;
}

function collectModuleStateConsumerNodeIds(
    pag: Pag,
    moduleStateNamesByFile: Map<string, Set<string>>,
): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue?.();
        if (!(value instanceof Local)) continue;

        const filePath = extractFilePathFromNode(node);
        if (!filePath) continue;
        const moduleStateNames = moduleStateNamesByFile.get(filePath);
        if (!moduleStateNames?.has(value.getName())) continue;

        const key = toModuleStateKey(filePath, value.getName());
        addConsumerNodeIds(out, key, pag, node.getID());
    }

    mergeExportedStaticFieldConsumerNodeIds(pag, moduleStateNamesByFile, out);
    return out;
}

function collectModuleImportBindingConsumerNodeIds(
    scene: Scene,
    pag: Pag,
    moduleStateNamesByFile: Map<string, Set<string>>,
): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    mergeImportBindingConsumerNodeIds(scene, pag, moduleStateNamesByFile, out);
    return out;
}

function collectStaticFieldConsumerNodeIds(pag: Pag): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        if (!(node instanceof PagStaticFieldNode)) continue;

        const key = node.getValue?.()?.toString?.() || "";
        if (!key) continue;
        if (!out.has(key)) out.set(key, new Set<number>());
        addExpandedConsumerNodeIds(out.get(key)!, pag, node.getID());
    }
    return out;
}

function mergeImportBindingConsumerNodeIds(
    scene: Scene,
    pag: Pag,
    moduleStateNamesByFile: Map<string, Set<string>>,
    out: Map<string, Set<number>>,
): void {
    for (const file of scene.getFiles()) {
        for (const importInfo of file.getImportInfos()) {
            const importLocal = ModelUtils.getLocalInImportInfoWithName(importInfo.getImportClauseName(), file);
            const exportLocal = importInfo.getLazyExportInfo()?.getArkExport();
            if (!(importLocal instanceof Local) || !(exportLocal instanceof Local)) continue;

            const exportFilePath = extractFilePathFromLocal(exportLocal);
            if (!exportFilePath) continue;
            const exportName = exportLocal.getName?.() || "";
            if (!exportName) continue;

            const moduleStateNames = moduleStateNamesByFile.get(exportFilePath);
            if (!moduleStateNames?.has(exportName)) continue;

            const key = toModuleStateKey(exportFilePath, exportName);
            const importFilePath = file.getFileSignature?.().toString?.().match(/@([^:>]+):/)?.[1]?.replace(/\\/g, "/") || "";
            if (!importFilePath) continue;

            const consumerNodeIds = collectImportBindingConsumerNodeIds(
                scene,
                pag,
                importFilePath,
                importLocal.getName(),
            );
            for (const nodeId of consumerNodeIds) {
                addDirectConsumerNodeId(out, key, nodeId);
            }

            const relayConsumerNodeIds = collectModuleImportRelayConsumerNodeIds(
                scene,
                importLocal,
                importFilePath,
                pag,
                moduleStateNamesByFile,
            );
            for (const nodeId of relayConsumerNodeIds) {
                addDirectConsumerNodeId(out, key, nodeId);
            }
        }
    }
}

function mergeExportedStaticFieldConsumerNodeIds(
    pag: Pag,
    moduleStateNamesByFile: Map<string, Set<string>>,
    out: Map<string, Set<number>>,
): void {
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        if (!(node instanceof PagStaticFieldNode)) continue;

        const parsed = parseExportedStaticFieldKey(node.getValue?.()?.toString?.() || "");
        if (!parsed) continue;

        const moduleStateNames = moduleStateNamesByFile.get(parsed.filePath);
        if (!moduleStateNames?.has(parsed.fieldName)) continue;

        const key = toModuleStateKey(parsed.filePath, parsed.fieldName);
        addConsumerNodeIds(out, key, pag, node.getID());
    }
}

function addExpandedConsumerNodeIds(target: Set<number>, pag: Pag, nodeId: number): void {
    target.add(nodeId);

    const firstHop = new Set<number>();
    const node = pag.getNode(nodeId) as PagNode;
    const firstCopyEdges = node?.getOutgoingCopyEdges?.();
    if (firstCopyEdges) {
        for (const edge of firstCopyEdges) {
            const dstId = edge.getDstID();
            target.add(dstId);
            firstHop.add(dstId);
        }
    }

    for (const midId of firstHop) {
        const midNode = pag.getNode(midId) as PagNode;
        const secondCopyEdges = midNode?.getOutgoingCopyEdges?.();
        if (!secondCopyEdges) continue;
        for (const edge of secondCopyEdges) {
            target.add(edge.getDstID());
        }
    }
}

function addConsumerNodeIds(
    out: Map<string, Set<number>>,
    key: string,
    pag: Pag,
    nodeId: number,
): void {
    if (!out.has(key)) out.set(key, new Set<number>());
    addExpandedConsumerNodeIds(out.get(key)!, pag, nodeId);
}

function addDirectConsumerNodeId(
    out: Map<string, Set<number>>,
    key: string,
    nodeId: number,
): void {
    if (!out.has(key)) out.set(key, new Set<number>());
    out.get(key)!.add(nodeId);
}

function collectCandidateAssignStmts(value: Local, taintedNode: PagNode): ArkAssignStmt[] {
    const out: ArkAssignStmt[] = [];
    const seen = new Set<string>();
    const addStmt = (stmt: any): void => {
        if (!(stmt instanceof ArkAssignStmt)) return;
        const key = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() ?? -1}:${stmt.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(stmt);
    };

    for (const stmt of value.getUsedStmts()) {
        addStmt(stmt);
    }

    const declCfg = value.getDeclaringStmt?.()?.getCfg?.();
    if (declCfg) {
        for (const stmt of declCfg.getStmts()) {
            addStmt(stmt);
        }
    }

    const nodeCfg = taintedNode.getStmt?.()?.getCfg?.();
    if (nodeCfg) {
        for (const stmt of nodeCfg.getStmts()) {
            addStmt(stmt);
        }
    }
    return out;
}

function extractFilePathFromNode(node: PagNode): string {
    const stmt = node.getStmt?.() || (node as any).stmt;
    const methodSig = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    return extractFilePathFromMethodSignature(methodSig);
}

function extractFilePathFromStmt(stmt: any): string {
    const methodSig = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    return extractFilePathFromMethodSignature(methodSig);
}

function extractFilePathFromLocal(local: Local): string {
    const methodSig = local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    return extractFilePathFromMethodSignature(methodSig);
}

function extractFilePathFromMethodSignature(methodSig: string): string {
    const matched = methodSig.match(/@([^:>]+):/);
    return matched ? matched[1].replace(/\\/g, "/") : "";
}

function collectLocalNodeIdsByFileAndName(
    pag: Pag,
    filePath: string,
    localName: string,
): number[] {
    const out: number[] = [];
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue?.();
        if (!(value instanceof Local)) continue;
        if ((value.getName?.() || "") !== localName) continue;
        if (extractFilePathFromNode(node) !== filePath) continue;
        out.push(node.getID());
    }
    return out;
}

function collectImportBindingConsumerNodeIds(
    scene: Scene,
    pag: Pag,
    filePath: string,
    localName: string,
): number[] {
    const blockedMethodSigs = new Set<string>();
    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.().toString?.() || "";
        if (extractFilePathFromMethodSignature(methodSig) !== filePath) continue;
        const cfg = method.getBody?.()?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local)) continue;
            if ((left.getName?.() || "") !== localName) continue;
            if (right instanceof ArkParameterRef || !(right instanceof Local)) {
                blockedMethodSigs.add(methodSig);
                break;
            }
        }
    }

    const out: number[] = [];
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue?.();
        if (!(value instanceof Local)) continue;
        if ((value.getName?.() || "") !== localName) continue;
        if (extractFilePathFromNode(node) !== filePath) continue;
        const nodeMethodSig = node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (blockedMethodSigs.has(nodeMethodSig)) continue;
        out.push(node.getID());
    }
    return out;
}

function collectModuleImportRelayConsumerNodeIds(
    scene: Scene,
    importLocal: Local,
    importFilePath: string,
    pag: Pag,
    moduleStateNamesByFile: Map<string, Set<string>>,
): number[] {
    const results = new Set<number>();
    const moduleStateNames = moduleStateNamesByFile.get(importFilePath);
    if (!moduleStateNames || moduleStateNames.size === 0) return [];

    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.().toString?.() || "";
        const methodFilePath = extractFilePathFromMethodSignature(
            methodSig,
        );
        if (methodFilePath !== importFilePath) continue;
        if (!methodSig.includes("%dflt.[static]%dflt()")) continue;
        const body = method.getBody?.();
        const cfg = body?.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof Local)) continue;
            if (!isSameLocal(right, importLocal)) continue;

            const leftName = left.getName?.() || "";
            if (!leftName || !moduleStateNames.has(leftName)) continue;

            for (const nodeId of collectLocalNodeIdsByFileAndName(pag, importFilePath, leftName)) {
                results.add(nodeId);
            }
            for (const nodeId of collectExportedStaticFieldNodeIdsByFileAndName(pag, importFilePath, leftName)) {
                results.add(nodeId);
            }
        }
    }

    return [...results];
}

function collectExportedStaticFieldNodeIdsByFileAndName(
    pag: Pag,
    filePath: string,
    fieldName: string,
): number[] {
    const out: number[] = [];
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        if (!(node instanceof PagStaticFieldNode)) continue;
        const parsed = parseExportedStaticFieldKey(node.getValue?.()?.toString?.() || "");
        if (!parsed) continue;
        if (parsed.filePath !== filePath || parsed.fieldName !== fieldName) continue;
        out.push(node.getID());
    }
    return out;
}

function parseExportedStaticFieldKey(sig: string): { filePath: string; fieldName: string } | null {
    const matched = sig.match(/^@([^:]+):\s+.*?\.?\[static\]([A-Za-z0-9_$]+)/);
    if (!matched) return null;
    return {
        filePath: matched[1].replace(/\\/g, "/"),
        fieldName: matched[2],
    };
}

function toModuleStateKey(filePath: string, localName: string): string {
    return `${filePath}::${localName}`;
}

function isSameLocal(a: any, b: Local): boolean {
    return a instanceof Local
        && (a === b || (a.getName?.() || "") === (b.getName?.() || ""));
}

function dedupFacts(facts: TaintFact[]): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    for (const fact of facts) {
        if (seen.has(fact.id)) continue;
        seen.add(fact.id);
        out.push(fact);
    }
    return out;
}
