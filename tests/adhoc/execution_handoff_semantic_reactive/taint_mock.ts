export function Component(): ClassDecorator {
    return function (_target: any): void {};
}

export function State(_target: any, _propertyKey: string): void {}

export function Watch(_field: string): MethodDecorator {
    return function (_target: any, _propertyKey: string | symbol, _descriptor: PropertyDescriptor): void {};
}

export function Monitor(_field: string): MethodDecorator {
    return function (_target: any, _propertyKey: string | symbol, _descriptor: PropertyDescriptor): void {};
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
