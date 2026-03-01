export function Watch(_name: string): any {
    return function (_target: any, _propertyKey: string, _descriptor?: any): void {};
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
