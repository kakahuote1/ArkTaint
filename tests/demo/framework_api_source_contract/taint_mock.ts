export class Http {
    request(_url: string): any { return undefined; }
}

export class HttpClient {
    request(_url: string): any { return undefined; }
}

export class Preferences {
    get(_key: string): any { return undefined; }
    getSync(_key: string): any { return undefined; }
}

export class CachePreferences {
    get(_key: string): any { return undefined; }
    getSync(_key: string): any { return undefined; }
}

export class RdbStore {
    query(_sql: string): any { return undefined; }
    querySql(_sql: string): any { return undefined; }
}

export class MyRdbStore {
    query(_sql: string): any { return undefined; }
}

export class GlobalContext {
    getObject(_name: string): any { return undefined; }
}

export class fs {
    read(_path: string): any { return undefined; }
    readSync(_path: string): any { return undefined; }
    readText(_path: string): any { return undefined; }
    readTextSync(_path: string): any { return undefined; }
}

export class FileOperatorWrapper {
    read(_path: string): any { return undefined; }
}

export class request {
    download(_url: string): any { return undefined; }
    upload(_url: string): any { return undefined; }
}

export class RequestAgentWrapper {
    download(_url: string): any { return undefined; }
}

export class DistributedKVStore {
    get(_key: string): any { return undefined; }
}

export class MyDistributedKVStore {
    get(_key: string): any { return undefined; }
}

export class deviceInfo {
    udid: string = "udid";
}

export class deviceInfoProxy {
    udid: string = "udid";
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
