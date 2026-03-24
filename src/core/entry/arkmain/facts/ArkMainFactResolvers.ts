import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { createArkMainFactCollectionContext } from "./ArkMainFactContext";
import { collectCallbackFacts } from "./ArkMainCallbackFactResolver";
import { collectChannelHandoffFacts } from "./ArkMainChannelHandoffFactResolver";
import { collectChannelFacts } from "./ArkMainChannelFactResolver";
import { collectLifecycleFacts } from "./ArkMainLifecycleFactResolver";
import { collectReactiveFacts } from "./ArkMainReactiveFactResolver";
import { expandEntryMethodsByDirectCalls } from "../../shared/ExplicitEntryScopeResolver";
import { collectSchedulerFacts } from "./ArkMainSchedulerFactResolver";
import { ArkMainEntryFact, classifyArkMainFactOwnership } from "../ArkMainTypes";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";

export function collectArkMainEntryFacts(scene: Scene, explicitSeedMethods: ArkMethod[] = []): ArkMainEntryFact[] {
    const context = createArkMainFactCollectionContext(explicitSeedMethods);
    const _t: Record<string, number> = {};
    let _s = Date.now();
    collectLifecycleFacts(scene, context);
    _t.lifecycle = Date.now() - _s; _s = Date.now();
    collectChannelHandoffFacts(scene, context);
    _t.handoff = Date.now() - _s; _s = Date.now();
    collectCallbackFacts(scene, context);
    _t.callback = Date.now() - _s; _s = Date.now();
    collectSchedulerFacts(scene, context);
    _t.scheduler = Date.now() - _s; _s = Date.now();
    collectChannelFacts(scene, context);
    _t.channel = Date.now() - _s; _s = Date.now();
    collectReactiveFacts(scene, context);
    _t.reactive = Date.now() - _s;
    const total = Object.values(_t).reduce((a, b) => a + b, 0);
    if (total > 200) {
        console.log(`[ArkMain facts profiling] ${Object.entries(_t).map(([k, v]) => `${k}=${v}ms`).join(" ")} total=${total}ms`);
    }
    return context.facts.filter(fact => classifyArkMainFactOwnership(fact) !== "propagation_modeling");
}
export const expandSeedMethodsByDirectCalls = expandEntryMethodsByDirectCalls;

