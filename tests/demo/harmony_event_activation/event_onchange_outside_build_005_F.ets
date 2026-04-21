import { UIInput, cbOnChange } from "./taint_mock";

class EventPage005 {
    helper(): void {
        const input = new UIInput();
        input.onChange(cbOnChange);
    }

    onCreate(): void {
        this.helper();
    }

    build(): void {
        return;
    }
}

export function event_onchange_outside_build_005_F(): void {
    const page = new EventPage005();
    page.onCreate();
    page.build();
}
