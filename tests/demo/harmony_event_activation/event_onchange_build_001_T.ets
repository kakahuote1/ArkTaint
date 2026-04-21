import { UIInput, cbOnChange } from "./taint_mock";

class EventPage001 {
    build(): void {
        const input = new UIInput();
        input.onChange(cbOnChange);
    }
}

export function event_onchange_build_001_T(): void {
    const page = new EventPage001();
    page.build();
}
