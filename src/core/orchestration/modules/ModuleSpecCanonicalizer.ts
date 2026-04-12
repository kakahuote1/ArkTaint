import type {
    ModuleAddress,
    ModuleBridgeEmitSpec,
    ModuleDispatch,
    ModuleDispatchPreset,
    ModuleEndpoint,
    ModuleSemantic,
    ModuleSemanticSurfaceRef,
    ModuleSpec,
} from "../../kernel/contracts/ModuleSpec";

function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(item => stableSerialize(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function semanticSurfaceIdentity(surface: ModuleSemanticSurfaceRef): string {
    return `${surface.kind}:${stableSerialize(surface.selector)}`;
}

export function normalizeSurfaceRef(surfaceRef: ModuleSemanticSurfaceRef | string): ModuleSemanticSurfaceRef {
    if (typeof surfaceRef === "string") {
        return {
            kind: "invoke",
            selector: {
                methodName: surfaceRef,
            },
        };
    }
    return surfaceRef;
}

function inferCallbackDispatchPreset(
    sourceSurface: ModuleSemanticSurfaceRef | undefined,
    targetSurface: ModuleSemanticSurfaceRef,
): ModuleDispatchPreset {
    if (
        sourceSurface
        && sourceSurface.kind === "invoke"
        && targetSurface.kind === "invoke"
        && semanticSurfaceIdentity(sourceSurface) === semanticSurfaceIdentity(targetSurface)
    ) {
        return "callback_sync";
    }
    return "callback_event";
}

function withInferredCallbackDispatch(
    dispatch: ModuleDispatch | undefined,
    reason: string,
    sourceSurface: ModuleSemanticSurfaceRef | undefined,
    target: ModuleEndpoint,
): ModuleDispatch | undefined {
    if (dispatch || target.slot !== "callback_param") {
        return dispatch;
    }
    return {
        preset: inferCallbackDispatchPreset(sourceSurface, normalizeSurfaceRef(target.surface)),
        reason,
    };
}

function applyEndpointDefaults(endpoint: ModuleEndpoint): ModuleEndpoint {
    const surface = normalizeSurfaceRef(endpoint.surface);
    switch (endpoint.slot) {
        case "callback_param":
            return {
                ...endpoint,
                surface,
                callbackArgIndex: endpoint.callbackArgIndex ?? 0,
                paramIndex: endpoint.paramIndex ?? 0,
            };
        default:
            return {
                ...endpoint,
                surface,
            };
    }
}

function applyAddressDefaults(address: ModuleAddress | undefined): ModuleAddress | undefined {
    if (!address) {
        return undefined;
    }
    if (address.kind === "endpoint") {
        return {
            ...address,
            endpoint: applyEndpointDefaults(address.endpoint),
        };
    }
    return address;
}

function applyDispatchDefaults(dispatch: ModuleDispatch | undefined): ModuleDispatch | undefined {
    if (!dispatch) {
        return undefined;
    }
    return {
        ...dispatch,
        via: dispatch.via ? applyEndpointDefaults(dispatch.via) : undefined,
    };
}

function applyEmitDefaults(
    emit: ModuleBridgeEmitSpec | undefined,
    fallbackReason: string,
): ModuleBridgeEmitSpec | undefined {
    if (!emit) {
        return undefined;
    }
    return {
        ...emit,
        reason: emit.reason || fallbackReason,
    };
}

function buildGeneratedSemanticIds(semantics: ModuleSemantic[]): string[] {
    const reserved = new Set<string>();
    for (const semantic of semantics) {
        if (typeof semantic.id === "string" && semantic.id.trim().length > 0) {
            reserved.add(semantic.id);
        }
    }
    return semantics.map((semantic, index) => {
        if (typeof semantic.id === "string" && semantic.id.trim().length > 0) {
            return semantic.id;
        }
        const base = `${semantic.kind}.${index}`;
        let candidate = base;
        let suffix = 1;
        while (reserved.has(candidate)) {
            candidate = `${base}.${suffix++}`;
        }
        reserved.add(candidate);
        return candidate;
    });
}

function applySemanticDefaults(semantic: ModuleSemantic, semanticIndex: number): ModuleSemantic & { id: string } {
    const semanticId = semantic.id || `${semantic.kind}.${semanticIndex}`;
    switch (semantic.kind) {
        case "bridge":
            return {
                ...semantic,
                id: semanticId,
                from: applyEndpointDefaults(semantic.from),
                to: applyEndpointDefaults(semantic.to),
                constraints: semantic.constraints?.map(constraint => constraint.kind === "same_address"
                    ? {
                        ...constraint,
                        left: applyAddressDefaults(constraint.left)!,
                        right: applyAddressDefaults(constraint.right)!,
                    }
                    : constraint),
                dispatch: withInferredCallbackDispatch(
                    applyDispatchDefaults(semantic.dispatch),
                    semanticId,
                    normalizeSurfaceRef(applyEndpointDefaults(semantic.from).surface),
                    applyEndpointDefaults(semantic.to),
                ),
                emit: applyEmitDefaults(semantic.emit, semanticId),
            };
        case "state":
            return {
                ...semantic,
                id: semanticId,
                cell: semantic.cell.kind === "field"
                    ? {
                        ...semantic.cell,
                        carrier: applyEndpointDefaults(semantic.cell.carrier),
                    }
                    : semantic.cell,
                writes: semantic.writes.map((write, index) => ({
                    ...write,
                    from: applyEndpointDefaults(write.from),
                    address: applyAddressDefaults(write.address),
                    emit: applyEmitDefaults(write.emit, `${semanticId}.write.${index}`),
                })),
                reads: semantic.reads.map((read, index) => ({
                    ...read,
                    to: applyEndpointDefaults(read.to),
                    address: applyAddressDefaults(read.address),
                    dispatch: withInferredCallbackDispatch(
                        applyDispatchDefaults(read.dispatch),
                        `${semanticId}.read.${index}`,
                        undefined,
                        applyEndpointDefaults(read.to),
                    ),
                    emit: applyEmitDefaults(read.emit, `${semanticId}.read.${index}`),
                })),
            };
        case "declarative_binding":
            return {
                ...semantic,
                id: semanticId,
                dispatch: applyDispatchDefaults(semantic.dispatch),
            };
        default:
            return {
                ...semantic,
                id: semanticId,
            };
    }
}

export function canonicalizeModuleSpec(spec: ModuleSpec): ModuleSpec {
    const semanticIds = buildGeneratedSemanticIds(spec.semantics);
    return {
        ...spec,
        description: spec.description ?? spec.id,
        semantics: spec.semantics.map((semantic, index) => applySemanticDefaults({
            ...semantic,
            id: semanticIds[index],
        }, index)),
    };
}
