export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export function SourceReturn(v: any): any {
        return v;
    }

    export function SourceOther(v: any): any {
        return v;
    }

    export function SourceArg(a: any, b: any): void {
        console.log(a, b);
    }

    export function SourceArgOther(a: any, b: any): void {
        console.log(a, b);
    }

    export function SourceScope(v: any): any {
        return v;
    }
}
