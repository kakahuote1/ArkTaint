export class Router {
    private static params: any = "safe_default";

    static pushUrl(options: { url: string; params?: any }): void {
        if (options && options.params !== undefined) {
            Router.params = options.params;
        }
    }

    static replaceUrl(options: { url: string; params?: any }): void {
        if (options && options.params !== undefined) {
            Router.params = options.params;
        }
    }

    static pushNamedRoute(options: { name: string; params?: any }): void {
        if (options && options.params !== undefined) {
            Router.params = options.params;
        }
    }

    static getParams(): any {
        return Router.params;
    }
}

export class NavPathStack {
    private static paramStoreByName: Map<string, any> = new Map<string, any>();
    private static lastRouteName: string = "default";

    static pushPath(options: { name: string; param?: any }): void {
        const routeName = options?.name || "default";
        NavPathStack.lastRouteName = routeName;
        if (options && options.param !== undefined) {
            NavPathStack.paramStoreByName.set(routeName, options.param);
        }
    }

    static pushPathByName(options: { name: string; param?: any }): void {
        const routeName = options?.name || "default";
        NavPathStack.lastRouteName = routeName;
        if (options && options.param !== undefined) {
            NavPathStack.paramStoreByName.set(routeName, options.param);
        }
    }

    static getParams(routeName?: string): any {
        const target = routeName || NavPathStack.lastRouteName;
        if (NavPathStack.paramStoreByName.has(target)) {
            return NavPathStack.paramStoreByName.get(target);
        }
        return "safe_nav_default";
    }
}

export class NavDestination {
    private static builders: Map<string, (param: any) => void> = new Map<string, (param: any) => void>();

    static register(name: string, builder: (param: any) => void): void {
        NavDestination.builders.set(name, builder);
    }

    static trigger(name: string): void {
        const builder = NavDestination.builders.get(name);
        if (builder) {
            builder(NavPathStack.getParams(name));
        }
    }
}

export namespace taint {
    export function Sink(v: any): void {
        console.log(v);
    }

    export function Source(): string {
        return "tainted_from_source";
    }
}
