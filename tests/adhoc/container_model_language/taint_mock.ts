export namespace taint {
    export function Sink(value: any): void {
        console.log(value);
    }
}

export class Preferences {
    put(_key: string, _value: any): void {}
    putSync(_key: string, _value: any): void {}
    get(_key: string): any { return undefined; }
    getSync(_key: string): any { return undefined; }
}

export class GlobalContext {
    private static singleton = new GlobalContext();

    static getContext(): GlobalContext {
        return GlobalContext.singleton;
    }

    setObject(_key: string, _value: any): void {}
    getObject(_key: string): any { return undefined; }
}

export class DistributedKVStore {
    put(_key: string, _value: any): void {}
    get(_key: string): any { return undefined; }
}
