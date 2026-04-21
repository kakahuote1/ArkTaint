export class Payload {
    value: string = "";
}

export class AppStorage {
    private static slots: Map<string, any> = new Map<string, any>();

    static set(key: string, value: any): void {
        AppStorage.slots.set(key, value);
    }

    static setOrCreate(key: string, value: any): any {
        if (!AppStorage.slots.has(key)) {
            AppStorage.slots.set(key, value);
        }
        return AppStorage.slots.get(key);
    }

    static get(key: string): any {
        return AppStorage.slots.get(key);
    }

    static prop(key: string): any {
        return AppStorage.get(key);
    }

    static link(key: string): any {
        return AppStorage.get(key);
    }
}

export function StorageProp(_key: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function StorageLink(_key: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export namespace taint {
    export function Source(): string {
        return "tainted";
    }

    export function SourceObj(): Payload {
        const p = new Payload();
        p.value = "tainted_obj";
        return p;
    }

    export function Sink(v: any): void {
        console.log(v);
    }
}
