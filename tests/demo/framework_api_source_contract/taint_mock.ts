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

export class AppAccountManager {
    getCredential(_name: string, _credentialType: string): any { return undefined; }
}

export class ProjectAccountManager {
    getCredential(_name: string, _credentialType: string): any { return undefined; }
}

export class RdbStore {
    query(_sql: string): any { return undefined; }
    querySql(_sql: string): any { return undefined; }
}

export class ChangeInfo {
    table: string = "users";
    type: string = "insert";
    inserted: Array<string> = ["1"];
    updated: Array<string> = ["2"];
    deleted: Array<string> = ["3"];
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
    static downloadFile(_context: unknown, _config: unknown): any { return undefined; }
    static uploadFile(_context: unknown, _config: unknown): any { return undefined; }
}

export class RequestAgentWrapper {
    download(_url: string): any { return undefined; }
    static downloadFile(_context: unknown, _config: unknown): any { return undefined; }
}

export class DistributedKVStore {
    get(_key: string): any { return undefined; }
    getEntries(_keyPrefix: string): any { return undefined; }
}

export class MyDistributedKVStore {
    get(_key: string): any { return undefined; }
    getEntries(_keyPrefix: string): any { return undefined; }
}

export class PhotoViewPicker {
    select(_option?: unknown): any { return undefined; }
}

export class ProjectPhotoViewPicker {
    select(_option?: unknown): any { return undefined; }
}

export class deviceInfo {
    udid: string = "udid";
}

export class deviceInfoProxy {
    udid: string = "udid";
}

export class WebDataBase {
    getHttpAuthCredentials(_host: string, _realm: string): any { return undefined; }
}

export class WebDataBaseProxy {
    getHttpAuthCredentials(_host: string, _realm: string): any { return undefined; }
}

export class WebResourceRequest {
    getRequestUrl(): any { return undefined; }
    getRequestHeader(): any { return undefined; }
    getMethod(): any { return undefined; }
}

export class WebResourceRequestProxy {
    getRequestUrl(): any { return undefined; }
}

export class RemoteObject {
    sendRequest(_code: number, _data: unknown): any { return undefined; }
    sendMessageRequest(_code: number, _data: unknown): any { return undefined; }
}

export class ProjectRemoteObject {
    sendRequest(_code: number, _data: unknown): any { return undefined; }
}

export namespace cacheDownload {
    export function download(_context: unknown, _config: unknown): any {
        return undefined;
    }
}

export class MessageParcel {
    readString(): any { return undefined; }
    readException(): any { return undefined; }
}

export class ProjectMessageParcel {
    readString(): any { return undefined; }
}

export class asset {
    static query(_options: unknown): any { return undefined; }
    static querySync(_options: unknown): any { return undefined; }
}

export class ProjectAsset {
    static query(_options: unknown): any { return undefined; }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
