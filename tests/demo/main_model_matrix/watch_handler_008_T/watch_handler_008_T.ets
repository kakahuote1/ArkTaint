function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}
function Watch(_name: string): any {
    return function (_target: any, _propertyKey: string, _descriptor?: any): void {};
}
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

    @Watch("token")
    onTokenWatch(): void {
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function watch_handler_008_T(): void {}
