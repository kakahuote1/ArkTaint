export class Http {
    request(_url: string, _data: any): any { return undefined; }
    requestAsync(_url: string, _cb: (resp: any) => void): void {}
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
