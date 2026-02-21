import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";

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

    return reachable;
}
