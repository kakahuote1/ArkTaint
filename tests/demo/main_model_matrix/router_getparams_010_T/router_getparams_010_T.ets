function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class Router {
    static getParams(): string {
        return "route";
    }
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    hydrateFromRoute(): void {
        const _params = Router.getParams();
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function router_getparams_010_T(): void {}
