import {
    CopyStateEffect,
    KillStateEffect,
    LinkStateEffect,
    LoadStateEffect,
    OclfsConfidence,
    SinkStateEffect,
    SourceStateEffect,
    StateCell,
    StateEffect,
    StateEffectBase,
    StateEffectKind,
    StateUpdateStrength,
    StoreCleanStateEffect,
    StoreStateEffect,
    UnlinkStateEffect,
} from "./OclfsTypes";

export interface StateEffectBuilderOptions {
    origin?: string;
    originAssetId?: string;
    confidence?: OclfsConfidence;
}

export class StateEffectBuilder {
    private nextSequence = 1;
    private readonly origin: string;
    private readonly originAssetId?: string;
    private readonly confidence: OclfsConfidence;

    constructor(options: StateEffectBuilderOptions = {}) {
        this.origin = options.origin || "oclfs-test";
        this.originAssetId = options.originAssetId;
        this.confidence = options.confidence || "certain";
    }

    value(name: string, version: string, scope = ""): StateCell {
        return {
            id: `value-version|${scope}|${name}#${version}`,
            kind: "value-version",
            scope,
            owner: name,
            valueVersion: `${name}#${version}`,
            precision: "exact",
        };
    }

    localSlot(name: string, scope = ""): StateCell {
        return {
            id: `local-slot|${scope}|${name}`,
            kind: "local-slot",
            scope,
            owner: name,
            precision: "exact",
        };
    }

    objectField(owner: string, fieldPath: string[], scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return {
            id: `object-field|${scope}|${owner}|${fieldPath.join(".")}|${precision}`,
            kind: "object-field",
            scope,
            owner,
            fieldPath: [...fieldPath],
            precision,
        };
    }

    mapEntry(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return {
            id: `map-entry|${scope}|${owner}|${key}|${precision}`,
            kind: "map-entry",
            scope,
            owner,
            key,
            precision,
        };
    }

    keyedSemanticSlot(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return {
            id: `keyed-semantic-slot|${scope}|${owner}|${key}|${precision}`,
            kind: "keyed-semantic-slot",
            scope,
            owner,
            key,
            precision,
        };
    }

    navigationParamSlot(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return keyedLocationCell("navigation-param-slot", owner, key, scope, precision);
    }

    messageChannelSlot(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return keyedLocationCell("message-channel-slot", owner, key, scope, precision);
    }

    asyncResultSlot(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return keyedLocationCell("async-result-slot", owner, key, scope, precision);
    }

    reactiveStateSlot(owner: string, key: string, scope = "", precision: "exact" | "partial" | "unknown" = "exact"): StateCell {
        return keyedLocationCell("reactive-state-slot", owner, key, scope, precision);
    }

    source(target: StateCell, label: string, programPoint = nextProgramPoint(this.nextSequence)): SourceStateEffect {
        return {
            ...this.base("source", programPoint),
            kind: "source",
            target,
            label,
        };
    }

    copy(from: StateCell, to: StateCell, label?: string, programPoint = nextProgramPoint(this.nextSequence)): CopyStateEffect {
        return {
            ...this.base("copy", programPoint),
            kind: "copy",
            from,
            to,
            label,
        };
    }

    store(
        location: StateCell,
        value: StateCell,
        label?: string,
        programPoint = nextProgramPoint(this.nextSequence),
        updateStrength?: StateUpdateStrength,
    ): StoreStateEffect {
        return {
            ...this.base("store", programPoint),
            kind: "store",
            location,
            value,
            label,
            updateStrength,
        };
    }

    load(location: StateCell, target: StateCell, label?: string, programPoint = nextProgramPoint(this.nextSequence)): LoadStateEffect {
        return {
            ...this.base("load", programPoint),
            kind: "load",
            location,
            target,
            label,
        };
    }

    storeClean(
        location: StateCell,
        programPoint = nextProgramPoint(this.nextSequence),
        updateStrength: StateUpdateStrength = "strong",
    ): StoreCleanStateEffect {
        return {
            ...this.base("store-clean", programPoint),
            kind: "store-clean",
            location,
            updateStrength,
        };
    }

    kill(
        location: StateCell,
        programPoint = nextProgramPoint(this.nextSequence),
        updateStrength: StateUpdateStrength = "strong",
    ): KillStateEffect {
        return {
            ...this.base("kill", programPoint),
            kind: "kill",
            location,
            updateStrength,
        };
    }

    link(left: StateCell, right: StateCell, programPoint = nextProgramPoint(this.nextSequence)): LinkStateEffect {
        return {
            ...this.base("link", programPoint),
            kind: "link",
            left,
            right,
        };
    }

    unlink(left: StateCell, right: StateCell, programPoint = nextProgramPoint(this.nextSequence)): UnlinkStateEffect {
        return {
            ...this.base("unlink", programPoint),
            kind: "unlink",
            left,
            right,
        };
    }

    sink(value: StateCell, sinkId: string, label?: string, programPoint = nextProgramPoint(this.nextSequence)): SinkStateEffect {
        return {
            ...this.base("sink", programPoint),
            kind: "sink",
            value,
            sinkId,
            label,
        };
    }

    buildLocalAssignmentSource(
        variableName: string,
        version: string,
        label: string,
        scope = "",
    ): { value: StateCell; slot: StateCell; effects: StateEffect[] } {
        const value = this.value(variableName, version, scope);
        const slot = this.localSlot(variableName, scope);
        return {
            value,
            slot,
            effects: [
                this.source(value, label),
                this.store(slot, value, label),
            ],
        };
    }

    private base(kind: StateEffectKind, programPoint: string): StateEffectBase {
        const sequence = this.nextSequence++;
        return {
            id: `state-effect|${sequence}|${kind}`,
            programPoint,
            sequence,
            origin: this.origin,
            originAssetId: this.originAssetId,
            confidence: this.confidence,
            kind,
        };
    }
}

function nextProgramPoint(sequence: number): string {
    return `test:${sequence}`;
}

function keyedLocationCell(
    kind: "navigation-param-slot" | "message-channel-slot" | "async-result-slot" | "reactive-state-slot",
    owner: string,
    key: string,
    scope: string,
    precision: "exact" | "partial" | "unknown",
): StateCell {
    return {
        id: `${kind}|${scope}|${owner}|${key}|${precision}`,
        kind,
        scope,
        owner,
        key,
        precision,
    };
}
