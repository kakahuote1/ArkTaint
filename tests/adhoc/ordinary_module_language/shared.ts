export let sharedValue: string = "_";

export function setSharedValue(value: string): void {
    sharedValue = value;
}

export function getSharedValue(): string {
    return sharedValue;
}

export class SharedBox {
    static slot: string = "_";
}

export function setStaticSlot(value: string): void {
    SharedBox.slot = value;
}

export function getStaticSlot(): string {
    return SharedBox.slot;
}
