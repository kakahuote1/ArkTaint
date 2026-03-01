import { UIInput, taint } from "./taint_mock";

function forward(v: string): void {
    taint.Sink(v);
}

class Page009 {
    build(): void {
        const input = new UIInput();
        input.onChange((value: string): void => {
            forward(value);
        });
    }
}

export function event_onchange_nested_009_T(): void {
    const page = new Page009();
    page.build();
}

