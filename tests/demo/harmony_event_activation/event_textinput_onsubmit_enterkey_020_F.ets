import { UIInput, cbTextInputOnSubmitEnterKey } from "./taint_mock";

class EventPage020 {
    build(): void {
        const input = new UIInput();
        input.onSubmit(cbTextInputOnSubmitEnterKey);
    }
}

export function event_textinput_onsubmit_enterkey_020_F(): void {
    const page = new EventPage020();
    page.build();
}
