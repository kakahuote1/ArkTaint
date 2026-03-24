import { defineSemanticPack, SemanticPack, SemanticPackEmission, TaintFact } from "../../core/kernel/contracts/SemanticPack";

export const harmonyAppStoragePack: SemanticPack = defineSemanticPack({
    id: "harmony.appstorage",
    description: "Built-in Harmony AppStorage/LocalStorage/PersistentStorage semantics.",
    setup(ctx) {
        const { buildAppStorageModel } = require("./AppStorageModeling") as typeof import("./AppStorageModeling");
        const model = buildAppStorageModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
            queries: ctx.queries,
        });
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

        return {
            onFact(event) {
                const writeKeySet = new Set<string>(writeKeysByNodeId.get(event.node.getID()) || []);
                if (event.fact.field && event.fact.field.length > 0) {
                    const endpointKey = `${event.node.getID()}#${event.fact.field[0]}`;
                    for (const key of writeKeysByFieldEndpoint.get(endpointKey) || []) {
                        writeKeySet.add(key);
                    }
                }
                if (writeKeySet.size === 0) return;

                const emissions: SemanticPackEmission[] = [];
                const dedup = new Set<string>();
                const push = (reason: string, fact: TaintFact): void => {
                    const key = `${reason}|${fact.id}`;
                    if (dedup.has(key)) return;
                    dedup.add(key);
                    emissions.push({ reason, fact });
                };

                for (const key of writeKeySet) {
                    const slotStateKey = `${key}|${event.fact.source}|${event.fact.contextID}|${event.fact.field ? event.fact.field.join(".") : ""}`;
                    if (slotTaintStates.has(slotStateKey)) continue;
                    slotTaintStates.add(slotStateKey);

                    const readNodeIds = model.readNodeIdsByKey.get(key);
                    if (readNodeIds) {
                        for (const readNodeId of readNodeIds) {
                            const readNode = event.pag.getNode(readNodeId) as any;
                            if (!readNode) continue;
                            push(
                                "AppStorage-Read",
                                new TaintFact(
                                    readNode,
                                    event.fact.source,
                                    event.fact.contextID,
                                    event.fact.field ? [...event.fact.field] : undefined,
                                ),
                            );
                        }
                    }

                    const readFieldNodeIds = model.readFieldNodeIdsByKey.get(key);
                    if (readFieldNodeIds) {
                        for (const fieldNodeId of readFieldNodeIds) {
                            const fieldNode = event.pag.getNode(fieldNodeId) as any;
                            if (!fieldNode) continue;
                            push(
                                "AppStorage-DecorFieldNode",
                                new TaintFact(
                                    fieldNode,
                                    event.fact.source,
                                    event.fact.contextID,
                                    event.fact.field ? [...event.fact.field] : undefined,
                                ),
                            );
                        }
                    }

                    for (const endpoint of model.readFieldEndpointsByKey.get(key) || []) {
                        const objectNode = event.pag.getNode(endpoint.objectNodeId) as any;
                        if (!objectNode) continue;
                        const isSelfEndpointEcho = event.fact.node.getID() === endpoint.objectNodeId
                            && !!event.fact.field
                            && event.fact.field.length > 0
                            && event.fact.field[0] === endpoint.fieldName;
                        if (isSelfEndpointEcho) continue;
                        push(
                            "AppStorage-Decor",
                            new TaintFact(
                                objectNode,
                                event.fact.source,
                                event.fact.contextID,
                                [endpoint.fieldName],
                            ),
                        );
                    }
                }

                return emissions;
            },
        };
    },
});

export default harmonyAppStoragePack;
