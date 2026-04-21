export class Want {
    parameters: string = "";
}

export class UIInput {
    onChange(_cb: (value: string) => void): void {}
}

export class AppStorage {
    private static slots: Map<string, any> = new Map<string, any>();

    static set(key: string, value: any): void {
        AppStorage.slots.set(key, value);
    }

    static get(key: string): any {
        return AppStorage.slots.get(key);
    }

    static setOrCreate(key: string, value: any): any {
        if (!AppStorage.slots.has(key)) {
            AppStorage.slots.set(key, value);
        }
        return AppStorage.slots.get(key);
    }
}

export function StorageProp(_key: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function State(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Prop(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
