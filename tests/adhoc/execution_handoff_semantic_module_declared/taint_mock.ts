export class UnknownAsync {
    onReady(_callback: () => void): void {}
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
