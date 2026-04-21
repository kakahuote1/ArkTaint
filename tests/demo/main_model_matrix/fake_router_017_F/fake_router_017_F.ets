function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class FakeRouter {
    static getParams(): string {
        return "fake";
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
        const _params = FakeRouter.getParams();
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function fake_router_017_F(): void {}
