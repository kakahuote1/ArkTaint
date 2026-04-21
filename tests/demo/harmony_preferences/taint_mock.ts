export class Preferences {
    private slots: Map<string, any> = new Map<string, any>();

    put(_key: string, _value: any): void {}
    get(_key: string): any { return undefined; }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
