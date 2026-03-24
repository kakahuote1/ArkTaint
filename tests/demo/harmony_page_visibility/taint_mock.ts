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
        return "tainted_page_source";
    }

    export function Sink(v: any): void {
        void v;
    }
}

