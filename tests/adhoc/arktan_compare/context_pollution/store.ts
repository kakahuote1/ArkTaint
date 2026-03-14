class Holder {
    private value: string;

    constructor() {
        let init = "safe";
        this.value = init;
    }

    set(v: string): void {
        let copy = v;
        this.value = copy;
    }

    get(): string {
        return this.value;
    }
}

const sharedHolder = new Holder();

export function writeShared(v: string): void {
    sharedHolder.set(v);
}

export function readShared(): string {
    return sharedHolder.get();
}
