export class Router {
    static _params: string = "router_payload";

    static pushUrl(options: { url: string; params?: string }): void {
        if (options.params !== undefined) {
            Router._params = options.params;
        }
    }

    static getParams(): string {
        return Router._params;
    }
}

export class FakeRouter {
    static getParams(): string {
        return "safe";
    }
}

export class AppStorage {
    private static slots: Map<string, any> = new Map<string, any>();

    static set(key: string, value: any): void {
        AppStorage.slots.set(key, value);
    }

    static get(key: string): any {
        return AppStorage.slots.get(key);
    }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }
}
