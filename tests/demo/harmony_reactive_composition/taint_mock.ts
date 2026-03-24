export function State(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Link(_key?: string): any {
    return function (_target: any, _propertyKey: string): void {};
}

export function Watch(_name: string): any {
    return function (_target: any, _propertyKey: string, _descriptor?: any): void {};
}

export class Router {
    private static params: any = "safe_default";

    static pushUrl(options: { url: string; params?: any }): void {
        if (options && options.params !== undefined) {
            Router.params = options.params;
        }
    }

    static getParams(): any {
        return Router.params;
    }
}

export namespace taint {
    export function Source(): string {
        return "tainted_reactive_source";
    }

    export function Sink(v: any): void {
        void v;
    }
}

