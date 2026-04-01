import {
    emptySemanticPackAuditSnapshot,
    SemanticPackAuditSnapshot,
    SemanticPack,
    SemanticPackCopyEdgeEvent,
    SemanticPackEmission,
    SemanticPackFactEvent,
    SemanticPackInvokeEvent,
    SemanticPackRuntime,
    SemanticPackSession,
    SemanticPackSetupContext,
} from "../../kernel/contracts/SemanticPack";
import {
    extractErrorLocation,
    getExtensionSourceModulePath,
    preferExtensionSourceLocation,
} from "../ExtensionLoaderUtils";

interface RegisteredSession {
    packId: string;
    session: SemanticPackSession;
    sourcePath?: string;
}

class PackRuntimeDiagnosticError extends Error {
    readonly diagnosticCode: string;
    readonly diagnosticAdvice: string;

    constructor(message: string, diagnosticCode: string, diagnosticAdvice: string) {
        super(message);
        this.name = "PackRuntimeDiagnosticError";
        this.diagnosticCode = diagnosticCode;
        this.diagnosticAdvice = diagnosticAdvice;
    }
}

function normalizePhaseCode(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function classifyPackFailure(
    hook: string,
    error: unknown,
): { code: string; advice: string } {
    if (error instanceof PackRuntimeDiagnosticError) {
        return {
            code: error.diagnosticCode,
            advice: error.diagnosticAdvice,
        };
    }
    const phaseCode = normalizePhaseCode(hook);
    return {
        code: `PACK_${phaseCode}_THROW`,
        advice: "这是该 semantic pack 在这个回调里直接抛出的异常。请先检查附近代码、空值访问和 helper 返回值。",
    };
}

class DefaultSemanticPackRuntime implements SemanticPackRuntime {
    private readonly failedPackIds = new Set<string>();
    private readonly audit: SemanticPackAuditSnapshot;

    constructor(
        private readonly packIds: string[],
        private readonly sessions: RegisteredSession[],
    ) {
        this.audit = emptySemanticPackAuditSnapshot();
        this.audit.loadedPackIds = [...packIds];
    }

    listPackIds(): string[] {
        return [...this.packIds];
    }

    getAuditSnapshot(): SemanticPackAuditSnapshot {
        return {
            loadedPackIds: [...this.audit.loadedPackIds],
            failedPackIds: [...this.audit.failedPackIds],
            failureEvents: this.audit.failureEvents.map(event => ({ ...event })),
        };
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
        for (const { packId, session, sourcePath } of this.sessions) {
            if (this.failedPackIds.has(packId)) continue;
            const callback = session[hook];
            if (!callback) continue;
            const staged: SemanticPackEmission[] = [];
            try {
                const emitted = callback(event as any);
                if (!emitted || emitted.length === 0) continue;
                for (const item of emitted) {
                    if (!item || !item.fact || typeof item.reason !== "string" || item.reason.trim().length === 0) {
                        throw new PackRuntimeDiagnosticError(
                            `semantic pack ${packId} returned an invalid ${hook} emission`,
                            `PACK_${normalizePhaseCode(hook)}_INVALID_EMISSION`,
                            "检查返回的 emission 是否包含 fact 和非空 reason，数组里不要放 undefined 或非法对象。",
                        );
                    }
                    staged.push(item);
                }
            } catch (error) {
                this.disablePack(packId, hook, error, sourcePath);
                continue;
            }
            out.push(...staged);
        }
        return out;
    }

    shouldSkipCopyEdge(event: SemanticPackCopyEdgeEvent): boolean {
        for (const { packId, session, sourcePath } of this.sessions) {
            if (this.failedPackIds.has(packId)) continue;
            let shouldSkip = false;
            try {
                shouldSkip = session.shouldSkipCopyEdge?.(event) === true;
            } catch (error) {
                this.disablePack(packId, "shouldSkipCopyEdge", error, sourcePath);
                continue;
            }
            if (shouldSkip) {
                return true;
            }
        }
        return false;
    }

    disablePack(packId: string, hook: string, error: unknown, sourcePath?: string): void {
        if (this.failedPackIds.has(packId)) return;
        const message = String((error as any)?.message || error);
        const classification = classifyPackFailure(hook, error);
        const location = preferExtensionSourceLocation(extractErrorLocation(error), sourcePath);
        const locationSuffix = location.path
            ? location.line && location.column
                ? ` @ ${location.path}:${location.line}:${location.column}`
                : ` @ ${location.path}`
            : "";
        this.failedPackIds.add(packId);
        this.audit.failedPackIds = [...this.failedPackIds.values()];
        this.audit.failureEvents.push({
            packId,
            phase: hook as "setup" | "onFact" | "onInvoke" | "shouldSkipCopyEdge",
            message,
            code: classification.code,
            advice: classification.advice,
            path: location.path,
            line: location.line,
            column: location.column,
            stackExcerpt: location.stackExcerpt,
            userMessage: `semantic pack ${packId} failed in ${hook}${locationSuffix}: ${message}`,
        });
        console.warn(
            `semantic pack ${packId} disabled after ${hook} failure${locationSuffix}: ${message}`,
        );
    }
}

export function createSemanticPackRuntime(
    packs: SemanticPack[],
    ctx: SemanticPackSetupContext,
): SemanticPackRuntime {
    const sessions: RegisteredSession[] = [];
    const runtime = new DefaultSemanticPackRuntime(
        packs.map(pack => pack.id),
        sessions,
    );

    for (const pack of packs) {
        let session: SemanticPackSession | void;
        try {
            session = pack.setup?.(ctx);
        } catch (error) {
            runtime.disablePack(pack.id, "setup", error, getExtensionSourceModulePath(pack));
            continue;
        }
        if (!session) continue;
        sessions.push({
            packId: pack.id,
            session,
            sourcePath: getExtensionSourceModulePath(pack),
        });
    }

    return runtime;
}
