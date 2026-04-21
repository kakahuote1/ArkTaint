export class UIAbility {}

export class Want {
    parameters: string = "";
}

export class WindowStage {}

export function Watch(_name: string): any {
    return function (_target: any, _propertyKey: string, _descriptor?: any): void {};
}

export function State(): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Prop(): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Link(): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function ObjectLink(): any {
    return function (_target: any, _propertyKey: string): void {};
}

export class UIInput {
    onClick(_cb: (event: string) => void): void {}

    onChange(_cb: (value: string) => void): void {}
}

export class Router {
    static pushUrl(_options: { url: string; params?: string }): void {}

    static getParams(): string {
        return "route_payload";
    }
}

export class AppStorage {
    static get(_key: string): string {
        return "stored_payload";
    }
}
