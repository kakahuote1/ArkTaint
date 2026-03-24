export function Provide(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Consume(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
