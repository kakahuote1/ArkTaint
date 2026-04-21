function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class UIInput {
    onClick(_cb: () => void): void {}
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

function cbOnClick(): void {
    const data = Source();
    Sink(data);
}

@Entry
@Component
struct DemoPage {
    build(): void {
        const input = new UIInput();
        input.onClick(cbOnClick);
    }
}

export function callback_build_006_T(): void {}
