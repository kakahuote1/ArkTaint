import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { isCallableValue, resolveCalleeCandidates, resolveMethodsFromCallable } from "./CalleeResolver";

export interface EntryMethodSpec {
    name: string;
    pathHint?: string;
}

export function resolveEntryMethod(scene: Scene, entryMethodName: string, entryMethodPathHint?: string): any | null {
    const candidates = scene.getMethods().filter(method => method.getName() === entryMethodName);
    let resolved = candidates.length > 0 ? candidates[0] : null;

    if (entryMethodPathHint && candidates.length > 0) {
        const normalizedHint = entryMethodPathHint.replace(/\\/g, "/");
        const hintedMethod = candidates.find(method => method.getSignature().toString().includes(normalizedHint));
        if (hintedMethod) {
            resolved = hintedMethod;
        }
    }

    return resolved;
}

export function resolveEntryMethods(scene: Scene, entries: EntryMethodSpec[]): any[] {
    const methods: any[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const method = resolveEntryMethod(scene, entry.name, entry.pathHint);
        if (!method) {
            throw new Error(`No ${entry.name}() method found in scene`);
        }
        const signature = method.getSignature().toString();
        if (seen.has(signature)) continue;
        seen.add(signature);
        methods.push(method);
    }
    return methods;
}

export function computeReachableMethodSignatures(
    scene: Scene,
    cg: CallGraph,
    entryMethodName: string,
    entryMethodPathHint?: string
): Set<string> {
    const entryMethod = resolveEntryMethod(scene, entryMethodName, entryMethodPathHint);
    if (!entryMethod) {
        throw new Error(`No ${entryMethodName}() method found in scene`);
    }

    const entryNodeId = cg.getCallGraphNodeByMethod(entryMethod.getSignature()).getID();
    const queue: number[] = [entryNodeId];
    const visited = new Set<number>();
    const reachable = new Set<string>();

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const methodSig = cg.getMethodByFuncID(nodeId);
        if (methodSig) {
            reachable.add(methodSig.toString());
        }

        const node = cg.getNode(nodeId);
        if (!node) continue;
        for (const edge of node.getOutgoingEdges()) {
            queue.push(edge.getDstID());
        }
    }

    // Harmony component entry methods often consume state initialized in
    // constructor/%instInit, but CG reachability from a lifecycle callback
    // does not always include those init methods. Add same-class init methods
    // to keep source seeding/propagation consistent for entry-local analysis.
    expandReachableWithSameClassInitializers(scene, entryMethod, reachable);
    expandReachableWithAsyncCallbacks(scene, reachable);
    expandReachableWithWatchHandlers(scene, reachable);

    return reachable;
}

function expandReachableWithSameClassInitializers(
    scene: Scene,
    entryMethod: any,
    reachable: Set<string>
): void {
    const classInitializerNames = new Set(["constructor", "%instInit", "%statInit"]);
    const fileInitializerNames = new Set(["%dflt"]);
    const entryClassName = entryMethod.getDeclaringArkClass?.()?.getName?.() || "";
    const entrySig = entryMethod.getSignature?.().toString?.() || "";
    const entryFile = extractFilePathFromSignature(entrySig);

    for (const method of scene.getMethods()) {
        const methodName = method.getName?.() || "";
        if (!classInitializerNames.has(methodName) && !fileInitializerNames.has(methodName)) continue;

        const methodSig = method.getSignature?.().toString?.() || "";
        if (!methodSig) continue;

        const methodClassName = method.getDeclaringArkClass?.()?.getName?.() || "";
        const sameClass = entryClassName.length > 0 && methodClassName === entryClassName;
        const sameFile = entryFile.length > 0 && extractFilePathFromSignature(methodSig) === entryFile;
        const shouldAddByClass = classInitializerNames.has(methodName) && (sameClass || sameFile);
        const shouldAddByFile = fileInitializerNames.has(methodName) && sameFile;
        if (shouldAddByClass || shouldAddByFile) {
            reachable.add(methodSig);
        }
    }
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : "";
}

function expandReachableWithAsyncCallbacks(
    scene: Scene,
    reachable: Set<string>
): void {
    const methodsBySig = new Map<string, any>();
    for (const method of scene.getMethods()) {
        methodsBySig.set(method.getSignature().toString(), method);
    }

    let changed = true;
    while (changed) {
        changed = false;
        const snapshot = Array.from(reachable);
        for (const methodSig of snapshot) {
            const method = methodsBySig.get(methodSig);
            if (!method) continue;
            const cfg = method.getCfg?.();
            if (!cfg) continue;

            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr?.();
                if (!invokeExpr) continue;

                const resolvedCallees = resolveCalleeCandidates(scene, invokeExpr);
                for (const resolved of resolvedCallees) {
                    const calleeSig = resolved.method?.getSignature?.().toString?.();
                    if (!calleeSig) continue;
                    if (!reachable.has(calleeSig)) {
                        reachable.add(calleeSig);
                        changed = true;
                    }
                    const sizeBeforeInitExpand = reachable.size;
                    expandReachableWithSameClassInitializers(scene, resolved.method, reachable);
                    if (reachable.size > sizeBeforeInitExpand) {
                        changed = true;
                    }
                }

                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                const callbackArgIndexes = collectCallableArgIndexes(args);
                if (callbackArgIndexes.length === 0) continue;

                for (const callbackArgIndex of callbackArgIndexes) {
                    const callbackArg = args[callbackArgIndex];
                    let callbackMethods = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 });
                    if (callbackMethods.length === 0) {
                        callbackMethods = resolveAsyncCallbackFallbackMethods(scene, method, callbackArg);
                    }
                    for (const cbMethod of callbackMethods) {
                        const cbSig = cbMethod?.getSignature?.().toString?.();
                        if (!cbSig) continue;
                        if (!reachable.has(cbSig)) {
                            reachable.add(cbSig);
                            changed = true;
                        }

                        const sizeBeforeInitExpand = reachable.size;
                        expandReachableWithSameClassInitializers(scene, cbMethod, reachable);
                        if (reachable.size > sizeBeforeInitExpand) {
                            changed = true;
                        }
                    }
                }
            }
        }
    }
}

function resolveAsyncCallbackFallbackMethods(scene: Scene, callerMethod: any, callbackArg: any): any[] {
    const candidates: any[] = [];
    const strictMatches: any[] = [];
    const callerSig = callerMethod?.getSignature?.().toString?.() || "";
    const callerFile = extractFilePathFromSignature(callerSig);
    if (!callerFile) return candidates;
    const callerName = callerMethod?.getName?.() || "";

    const candidateNames = new Set<string>();
    const callbackLocalName = callbackArg?.getName?.();
    if (callbackLocalName) candidateNames.add(String(callbackLocalName));
    const callbackText = callbackArg?.toString?.();
    if (callbackText) candidateNames.add(String(callbackText));

    for (const method of scene.getMethods()) {
        const methodName = method.getName?.() || "";
        if (!methodName.startsWith("%AM")) continue;

        const methodSig = method.getSignature?.().toString?.() || "";
        if (!methodSig) continue;
        if (extractFilePathFromSignature(methodSig) !== callerFile) continue;
        if (!method.getCfg?.()) continue;

        candidates.push(method);

        let matched = false;
        if (callerName && methodName.includes(`$${callerName}`)) {
            matched = true;
        } else if (candidateNames.has(methodName)) {
            matched = true;
        }
        if (matched) {
            strictMatches.push(method);
        }
    }

    if (strictMatches.length > 0) return strictMatches.slice(0, 8);
    if (candidates.length <= 8) return candidates;
    candidates.sort((a, b) => {
        const aLine = extractLineNoFromSignature(a.getSignature?.().toString?.() || "");
        const bLine = extractLineNoFromSignature(b.getSignature?.().toString?.() || "");
        return aLine - bLine;
    });
    return candidates.slice(0, 8);
}

function collectCallableArgIndexes(args: any[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < args.length; i++) {
        if (isCallableValue(args[i])) out.push(i);
    }
    return out;
}

function extractLineNoFromSignature(signature: string): number {
    const m = signature.match(/@[^:>]+:(\d+):\d+>/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

interface WatchHandlerDescriptor {
    methodSig: string;
    method: any;
}

function expandReachableWithWatchHandlers(
    scene: Scene,
    reachable: Set<string>
): void {
    const watchHandlersByClassAndField = collectWatchHandlersByClassAndField(scene);
    if (watchHandlersByClassAndField.size === 0) return;
    const methodsBySig = new Map<string, any>();
    for (const method of scene.getMethods()) {
        methodsBySig.set(method.getSignature().toString(), method);
    }

    let changed = true;
    while (changed) {
        changed = false;
        const snapshot = Array.from(reachable);
        for (const methodSig of snapshot) {
            const method = methodsBySig.get(methodSig);
            if (!method) continue;
            const className = method.getDeclaringArkClass?.()?.getName?.() || "";
            if (!className) continue;
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp();
                if (!(left instanceof ArkInstanceFieldRef)) continue;
                const fieldName = left.getFieldSignature?.().getFieldName?.() || "";
                if (!fieldName) continue;
                const handlerList = watchHandlersByClassAndField.get(`${className}#${fieldName}`);
                if (!handlerList || handlerList.length === 0) continue;
                for (const handler of handlerList) {
                    if (!reachable.has(handler.methodSig)) {
                        reachable.add(handler.methodSig);
                        changed = true;
                    }
                    const sizeBeforeInitExpand = reachable.size;
                    expandReachableWithSameClassInitializers(scene, handler.method, reachable);
                    if (reachable.size > sizeBeforeInitExpand) {
                        changed = true;
                    }
                }
            }
        }
    }
}

function collectWatchHandlersByClassAndField(scene: Scene): Map<string, WatchHandlerDescriptor[]> {
    const out = new Map<string, WatchHandlerDescriptor[]>();
    for (const method of scene.getMethods()) {
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const decorators = method.getDecorators?.() || [];
        if (!decorators || decorators.length === 0) continue;
        for (const decorator of decorators) {
            const kindRaw = String(decorator.getKind?.() || "").replace(/^@/, "").trim();
            if (kindRaw !== "Watch") continue;
            const watchField = extractWatchFieldName(decorator);
            if (!watchField) continue;
            const key = `${className}#${watchField}`;
            if (!out.has(key)) out.set(key, []);
            const methodSig = method.getSignature().toString();
            const list = out.get(key)!;
            if (list.some(item => item.methodSig === methodSig)) continue;
            list.push({ methodSig, method });
        }
    }
    return out;
}

function extractWatchFieldName(decorator: any): string | undefined {
    const fromParam = normalizeQuotedText(decorator.getParam?.());
    if (fromParam) return fromParam;
    const content = String(decorator.getContent?.() || "");
    if (!content) return undefined;
    const m = content.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (!m) return undefined;
    return normalizeQuotedText(m[1]);
}

function normalizeQuotedText(raw: any): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw).trim();
    if (!text) return undefined;
    const quoted = text.match(/^['"`](.+)['"`]$/);
    return quoted ? quoted[1] : text;
}
