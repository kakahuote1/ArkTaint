function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class UIInput {
    onClick(_cb: () => void): void {}
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

function cbIndirect(): void {
    const data = Source();
    Sink(data);
}

function registerThroughHelper(): void {
    const input = new UIInput();
    input.onClick(cbIndirect);
}

@Entry
@Component
struct DemoPage {
    build(): void {
        registerThroughHelper();
    }
}

export function indirect_callback_helper_016_T(): void {}
