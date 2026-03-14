import { UIInput, cbOnSubmit } from "./taint_mock";

class EventPage003 {
    build(): void {
        const input = new UIInput();
        input.onSubmit(cbOnSubmit);
    }
}

export function event_onsubmit_build_003_T(): void {
    const page = new EventPage003();
    page.build();
}
