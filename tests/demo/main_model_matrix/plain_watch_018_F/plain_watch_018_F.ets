function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}
function State(): any {
    return function (_target: any, _propertyKey: string): void {};
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    @State()
    token: string = "";

    onTokenWatch(): void {
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function plain_watch_018_F(): void {}
