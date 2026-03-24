import { defineSemanticPack, SemanticPack, SemanticPackEmission, TaintFact } from "../../core/kernel/contracts/SemanticPack";

export const harmonyRouterPack: SemanticPack = defineSemanticPack({
    id: "harmony.router",
    description: "Built-in Harmony router/nav destination bridges.",
    setup(ctx) {
        const { buildRouterModel } = require("./RouterModeling") as typeof import("./RouterModeling");
        const model = buildRouterModel({
            scene: ctx.scene,
            pag: ctx.pag,
            allowedMethodSignatures: ctx.allowedMethodSignatures,
            queries: ctx.queries,
            log: ctx.log,
        });
        const routerBridgeCount = Array.from(model.getResultNodeIdsByRouterKey.values())
            .reduce((acc, ids) => acc + ids.size, 0);
        if (model.pushCallCount > 0 || model.getCallCount > 0) {
            ctx.log(
                `[Harmony-Router] push_calls=${model.pushCallCount}, `
                + `get_calls=${model.getCallCount}, `
                + `bridged_nodes=${routerBridgeCount}, `
                + `suspicious_calls=${model.suspiciousCallCount}, `
                + `ungrouped_push_nodes=${model.ungroupedPushNodeIds.size}`,
            );
        }

        const loggedRouterConservativeSkips = new Set<string>();

        return {
            onFact(event) {
                const emissions: SemanticPackEmission[] = [];
                const dedup = new Set<string>();
                const push = (reason: string, fact: TaintFact): void => {
                    const key = `${reason}|${fact.id}`;
                    if (dedup.has(key)) return;
                    dedup.add(key);
                    emissions.push({ reason, fact });
                };

                const routerKeys = new Set<string>(model.pushArgNodeIdToRouterKeys.get(event.node.getID()) || []);
                const endpointKey = event.fact.field && event.fact.field.length > 0
                    ? `${event.node.getID()}#${event.fact.field[0]}`
                    : undefined;
                if (endpointKey) {
                    for (const routerKey of model.pushFieldEndpointToRouterKeys.get(endpointKey) || []) {
                        routerKeys.add(routerKey);
                    }
                }

                const valueFieldTargets = model.pushValueFieldTargetsByNodeId.get(event.node.getID()) || [];
                for (const target of valueFieldTargets) {
                    const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(target.routerKey);
                    if (!resultObjectIds || resultObjectIds.size === 0) continue;
                    const fieldPath = target.passthrough
                        ? (event.fact.field && event.fact.field.length > 0 ? [...event.fact.field] : undefined)
                        : (event.fact.field && event.fact.field.length > 0
                            ? [target.fieldName, ...event.fact.field]
                            : [target.fieldName]);
                    for (const objectNodeId of resultObjectIds) {
                        const objectNode = event.pag.getNode(objectNodeId) as any;
                        if (!objectNode) continue;
                        push(
                            "Harmony-RouterField",
                            new TaintFact(objectNode, event.fact.source, event.fact.contextID, fieldPath),
                        );
                    }
                }

                for (const routerKey of routerKeys) {
                    const targetNodeIds = model.getResultNodeIdsByRouterKey.get(routerKey);
                    if (targetNodeIds && targetNodeIds.size > 0) {
                        const isUngroupedPush = model.ungroupedPushNodeIds.has(event.node.getID())
                            || (!!endpointKey && model.ungroupedPushFieldEndpoints.has(endpointKey));
                        if (isUngroupedPush) {
                            const pushCount = model.pushCallCountByRouterKey.get(routerKey) || 0;
                            const routeCount = model.distinctRouteKeyCountByRouterKey.get(routerKey) || 0;
                            const hasAmbiguousTargets = targetNodeIds.size > 1;
                            const hasAmbiguousRoutes = routeCount === 0 || routeCount > 1;
                            if (pushCount > 1 && hasAmbiguousTargets && hasAmbiguousRoutes) {
                                const skipKey = `${routerKey}:${event.node.getID()}:${endpointKey || "-"}`;
                                if (!loggedRouterConservativeSkips.has(skipKey)) {
                                    loggedRouterConservativeSkips.add(skipKey);
                                    ctx.log(
                                        `[Harmony-Router] conservative skip for ungrouped push node=${event.node.getID()} `
                                        + `(router=${routerKey}, pushCount=${pushCount}, routeCount=${routeCount})`,
                                    );
                                }
                                continue;
                            }
                        }

                        for (const targetNodeId of targetNodeIds) {
                            const targetNode = event.pag.getNode(targetNodeId) as any;
                            if (!targetNode) continue;
                            push(
                                "Harmony-RouterBridge",
                                new TaintFact(
                                    targetNode,
                                    event.fact.source,
                                    event.fact.contextID,
                                    event.fact.field ? [...event.fact.field] : undefined,
                                ),
                            );
                        }
                    }

                    if (endpointKey) {
                        const resultObjectIds = model.getResultObjectNodeIdsByRouterKey.get(routerKey);
                        if (!resultObjectIds || resultObjectIds.size === 0) continue;
                        for (const objectNodeId of resultObjectIds) {
                            const objectNode = event.pag.getNode(objectNodeId) as any;
                            if (!objectNode) continue;
                            push(
                                "Harmony-RouterField",
                                new TaintFact(
                                    objectNode,
                                    event.fact.source,
                                    event.fact.contextID,
                                    [...event.fact.field!],
                                ),
                            );
                        }
                    }
                }

                return emissions.length > 0 ? emissions : undefined;
            },
        };
    },
});

export default harmonyRouterPack;
