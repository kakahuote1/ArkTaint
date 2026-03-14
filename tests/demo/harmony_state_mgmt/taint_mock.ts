export function State(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Prop(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Link(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function ObjectLink(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Observed(_target: any): void {}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
