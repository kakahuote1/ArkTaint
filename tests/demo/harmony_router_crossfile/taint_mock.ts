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
    export function Sink(v: any): void {
        console.log(v);
    }
}
