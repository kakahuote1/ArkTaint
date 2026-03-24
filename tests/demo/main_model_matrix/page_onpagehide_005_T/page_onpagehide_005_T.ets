function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    onPageHide(): void {
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function page_onpagehide_005_T(): void {}
