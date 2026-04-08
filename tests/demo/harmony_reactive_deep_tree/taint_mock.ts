export function State(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Link(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Provide(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Consume(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function ObjectLink(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Watch(_key?: string): any {
    return function (_target: any, _propertyKey: string, _descriptor: PropertyDescriptor): void {};
}

export class Router {
    private static params: any = { token: "safe-default" };

    static pushUrl(options: { url: string; params?: any }): void {
        if (options.params !== undefined) {
            Router.params = options.params;
        }
    }

    static getParams(): any {
        return Router.params;
    }
}

export class AppStorage {
    private static store: Map<string, any> = new Map<string, any>();

    static setOrCreate(key: string, value: any): void {
        AppStorage.store.set(key, value);
    }

    static get(key: string): any {
        return AppStorage.store.get(key);
    }
}

export class TokenModel {
    token: string = "";
}

export const taint = {
    Source(): string {
        return "reactive-deep-taint";
    },
    Sink(value: any): void {
        void value;
    },
};
