import { UIInput, cbOnInput } from "./taint_mock";

class EventPage002 {
    build(): void {
        const input = new UIInput();
        input.onInput(cbOnInput);
    }
}

export function event_oninput_build_002_T(): void {
    const page = new EventPage002();
    page.build();
}
