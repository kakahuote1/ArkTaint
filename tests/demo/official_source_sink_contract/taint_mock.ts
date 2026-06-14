export namespace taint {
    export function Source(): string {
        return "dirty";
    }
}

export class RemoteObject {
    sendRequest(_code: number, _data: unknown, _reply: unknown, _option: unknown): void {}
}

export class MessageParcel {
    writeString(_value: string): void {}
}

export class request {
    static downloadFile(_context: unknown, _config: unknown): void {}
}

export namespace cacheDownload {
    export function download(_context: unknown, _config: unknown): void {}
}

export class WebDataBase {
    saveHttpAuthCredentials(_host: string, _realm: string, _username: string, _password: string): void {}
}

export class CommonEventManager {
    publishAsUser(_event: string, _userId: number, _data: unknown): void {}
}

export class asset {
    static add(_value: unknown): void {}
    static update(_value: unknown): void {}
}

export class Verify {
    verify(_value: unknown): void {}
}
