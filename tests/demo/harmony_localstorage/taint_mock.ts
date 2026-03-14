export class LocalStorage {
    private static slots: Map<string, any> = new Map<string, any>();

    static set(key: string, value: any): void {
        LocalStorage.slots.set(key, value);
    }

    static setOrCreate(key: string, value: any): any {
        if (!LocalStorage.slots.has(key)) {
            LocalStorage.slots.set(key, value);
        }
        return LocalStorage.slots.get(key);
    }

    static get(key: string): any {
        return LocalStorage.slots.get(key);
    }

    static prop(key: string): any {
        return LocalStorage.get(key);
    }

    static link(key: string): any {
        return LocalStorage.get(key);
    }
}

export function LocalStorageProp(_key: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function LocalStorageLink(_key: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}

