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

export function ObservedV2(_target: any): void {}

export function Trace(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Local(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Param(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Once(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Event(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Monitor(_key?: string): any {
    return function (_target: any, _propertyKey?: string): void {};
}

export function Provider(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Consumer(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Computed(_target: any, _propertyKey: string, _desc: PropertyDescriptor): void {}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
