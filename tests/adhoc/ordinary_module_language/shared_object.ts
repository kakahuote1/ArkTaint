export interface SharedPayload {
    seed: string;
    other: string;
}

export let sharedBox: SharedPayload = {
    seed: "_",
    other: "_",
};

export function setSharedBox(value: SharedPayload): void {
    sharedBox = value;
}

export function getSharedBox(): SharedPayload {
    return sharedBox;
}

export class SharedHolder {
    static payload: SharedPayload = {
        seed: "_",
        other: "_",
    };
}

export function setStaticPayload(value: SharedPayload): void {
    SharedHolder.payload = value;
}

export function getStaticPayload(): SharedPayload {
    return SharedHolder.payload;
}
