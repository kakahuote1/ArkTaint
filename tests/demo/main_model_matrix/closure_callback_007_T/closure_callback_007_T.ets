function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class UIInput {
    onClick(_cb: () => void): void {}
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    build(): void {
        const prefix = "p:";
        const input = new UIInput();
        input.onClick(() => {
            const data = prefix + Source();
            Sink(data);
        });
    }
}

export function closure_callback_007_T(): void {}
