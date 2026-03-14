import { UIInput, taint } from "./taint_mock";

class Page011 {
    build(): void {
        const input = new UIInput();
        input.onChange2((first: string, second: string): void => {
            const _s = second;
            taint.Sink(first);
        });
    }
}

export function event_onchange2_first_only_011_F(): void {
    const page = new Page011();
    page.build();
}
