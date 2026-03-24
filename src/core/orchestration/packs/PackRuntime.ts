import {
    SemanticPack,
    SemanticPackCopyEdgeEvent,
    SemanticPackEmission,
    SemanticPackFactEvent,
    SemanticPackInvokeEvent,
    SemanticPackRuntime,
    SemanticPackSession,
    SemanticPackSetupContext,
} from "../../kernel/contracts/SemanticPack";

interface RegisteredSession {
    packId: string;
    session: SemanticPackSession;
}

class DefaultSemanticPackRuntime implements SemanticPackRuntime {
    constructor(
        private readonly packIds: string[],
        private readonly sessions: RegisteredSession[],
    ) {}

    listPackIds(): string[] {
        return [...this.packIds];
    }

    emitForFact(event: SemanticPackFactEvent): SemanticPackEmission[] {
        return this.collectEmissions("onFact", event);
    }

    emitForInvoke(event: SemanticPackInvokeEvent): SemanticPackEmission[] {
        return this.collectEmissions("onInvoke", event);
    }

    private collectEmissions(
        hook: "onFact" | "onInvoke",
        event: SemanticPackFactEvent | SemanticPackInvokeEvent,
    ): SemanticPackEmission[] {
        const out: SemanticPackEmission[] = [];
        for (const { packId, session } of this.sessions) {
            const callback = session[hook];
            if (!callback) continue;
            const emitted = callback(event as any);
            if (!emitted || emitted.length === 0) continue;
            for (const item of emitted) {
                if (!item || !item.fact || typeof item.reason !== "string" || item.reason.trim().length === 0) {
                    throw new Error(`semantic pack ${packId} returned an invalid ${hook} emission`);
                }
                out.push(item);
            }
        }
        return out;
    }

    shouldSkipCopyEdge(event: SemanticPackCopyEdgeEvent): boolean {
        for (const { session } of this.sessions) {
            if (session.shouldSkipCopyEdge?.(event)) {
                return true;
            }
        }
        return false;
    }
}

export function createSemanticPackRuntime(
    packs: SemanticPack[],
    ctx: SemanticPackSetupContext,
): SemanticPackRuntime {
    if (packs.length === 0) {
        return new DefaultSemanticPackRuntime([], []);
    }

    const sessions: RegisteredSession[] = [];
    const packIds: string[] = [];

    for (const pack of packs) {
        packIds.push(pack.id);
        const session = pack.setup?.(ctx);
        if (!session) continue;
        sessions.push({
            packId: pack.id,
            session,
        });
    }

    return new DefaultSemanticPackRuntime(packIds, sessions);
}
