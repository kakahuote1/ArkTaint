import { UIInput, cbOnChangeFirst } from "./taint_mock";

class EventPage007 {
    build(): void {
        const input = new UIInput();
        input.onChange2(cbOnChangeFirst);
    }
}

export function event_callback_param_index_wrong_007_F(): void {
    const page = new EventPage007();
    page.build();
}
