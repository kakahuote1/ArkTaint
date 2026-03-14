import { UIInput, taint } from "./taint_mock";

class Page010 {
    build(): void {
        const input = new UIInput();
        input.onChange2((first: string, second: string): void => {
            const _f = first;
            taint.Sink(second);
        });
    }
}

export function event_onchange2_second_010_T(): void {
    const page = new Page010();
    page.build();
}

