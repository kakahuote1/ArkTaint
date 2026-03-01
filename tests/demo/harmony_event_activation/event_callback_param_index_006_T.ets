import { UIInput, cbOnChangeSecond } from "./taint_mock";

class EventPage006 {
    build(): void {
        const input = new UIInput();
        input.onChange2(cbOnChangeSecond);
    }
}

export function event_callback_param_index_006_T(): void {
    const page = new EventPage006();
    page.build();
}
