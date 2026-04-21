export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export function BridgePtr(v: any): any {
        return "safe";
    }

    export function SafePtr(v: any): any {
        return "safe";
    }
}
