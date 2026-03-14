import { UIInput, cbOnClick } from "./taint_mock";

class EventPage004 {
    build(): void {
        const input = new UIInput();
        input.onClick(cbOnClick);
    }
}

export function event_onclick_build_004_F(): void {
    const page = new EventPage004();
    page.build();
}
