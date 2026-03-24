function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    onPageShow(): void {
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function page_onpageshow_004_T(): void {}
