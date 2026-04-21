export const MODEL_PLANES = ["rules", "modules", "arkmain"] as const;

export type ModelPlane = typeof MODEL_PLANES[number];

export interface ModelPackSelection {
    raw: string;
    packId: string;
    planes: ModelPlane[] | undefined;
}

export interface ModelPackPlaneState {
    rules: boolean;
    modules: boolean;
    arkmain: boolean;
}

export function parseModelPackSelection(rawValue: string): ModelPackSelection {
    const raw = String(rawValue || "").trim();
    if (!raw) {
        throw new Error("model selection must not be empty");
    }
    const colon = raw.indexOf(":");
    const packId = (colon >= 0 ? raw.slice(0, colon) : raw).trim();
    if (!packId) {
        throw new Error(`invalid model selection: ${raw}`);
    }
    if (colon < 0) {
        return {
            raw,
            packId,
            planes: undefined,
        };
    }
    const planeSpec = raw.slice(colon + 1).trim();
    if (!planeSpec) {
        throw new Error(`invalid model selection: ${raw}`);
    }
    const planes = [...new Set(planeSpec.split("+").map(item => item.trim()).filter(Boolean))];
    const invalid = planes.filter(item => !MODEL_PLANES.includes(item as ModelPlane));
    if (invalid.length > 0) {
        throw new Error(`invalid model plane in selection ${raw}: ${invalid.join(", ")}`);
    }
    return {
        raw,
        packId,
        planes: planes as ModelPlane[],
    };
}

export function normalizeModelPackSelections(values?: string[]): ModelPackSelection[] {
    return (values || [])
        .map(value => value.trim())
        .filter(Boolean)
        .map(parseModelPackSelection);
}

export function emptyModelPackPlaneState(): ModelPackPlaneState {
    return {
        rules: false,
        modules: false,
        arkmain: false,
    };
}

export function allModelPackPlaneState(): ModelPackPlaneState {
    return {
        rules: true,
        modules: true,
        arkmain: true,
    };
}

export function planeStateFromSelection(selection: ModelPackSelection): ModelPackPlaneState {
    if (!selection.planes || selection.planes.length === 0) {
        return allModelPackPlaneState();
    }
    const state = emptyModelPackPlaneState();
    for (const plane of selection.planes) {
        state[plane] = true;
    }
    return state;
}

export function cloneModelPackPlaneState(value?: ModelPackPlaneState): ModelPackPlaneState {
    return {
        rules: !!value?.rules,
        modules: !!value?.modules,
        arkmain: !!value?.arkmain,
    };
}

export function intersectModelPackPlaneState(
    left: ModelPackPlaneState,
    right: ModelPackPlaneState,
): ModelPackPlaneState {
    return {
        rules: left.rules && right.rules,
        modules: left.modules && right.modules,
        arkmain: left.arkmain && right.arkmain,
    };
}

export function mergeModelPackPlaneState(
    target: ModelPackPlaneState,
    incoming: ModelPackPlaneState,
): ModelPackPlaneState {
    target.rules = target.rules || incoming.rules;
    target.modules = target.modules || incoming.modules;
    target.arkmain = target.arkmain || incoming.arkmain;
    return target;
}

export function subtractModelPackPlaneState(
    target: ModelPackPlaneState,
    incoming: ModelPackPlaneState,
): ModelPackPlaneState {
    if (incoming.rules) target.rules = false;
    if (incoming.modules) target.modules = false;
    if (incoming.arkmain) target.arkmain = false;
    return target;
}

export function hasAnyModelPackPlane(state: ModelPackPlaneState): boolean {
    return state.rules || state.modules || state.arkmain;
}

export function modelPackPlaneList(state: ModelPackPlaneState): ModelPlane[] {
    const out: ModelPlane[] = [];
    if (state.rules) out.push("rules");
    if (state.modules) out.push("modules");
    if (state.arkmain) out.push("arkmain");
    return out;
}
