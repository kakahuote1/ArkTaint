export class AppStorage {
    static set(_key: string, _value: any): void {}
    static setOrCreate(_key: string, _value: any): void {}
    static get(_key: string): any { return undefined; }
    static prop(_key: string): any { return undefined; }
    static link(_key: string): any { return undefined; }
}

export class PersistentStorage {
    static persistProp(_key: string, _value: any): void {}
    static get(_key: string): any { return undefined; }
    static set(_key: string, _value: any): void {}
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}

