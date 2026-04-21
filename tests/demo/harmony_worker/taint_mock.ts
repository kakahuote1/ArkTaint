export class Worker {
    postMessage(_msg: any): void {}
    onMessage(_cb: (msg: any) => void): void {}
}

export namespace taskpool {
    export function execute(_task: (p: any) => any, _param: any): any {
        return undefined;
    }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
