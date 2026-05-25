import { Tabs, taint } from "./taint_mock";

class EventPage012 {
    build(): void {
        const tabs = new Tabs();
        tabs.onChange((index: number): void => {
            taint.Sink(index);
        });
    }
}

export function event_tabs_onchange_build_012_F(): void {
    const page = new EventPage012();
    page.build();
}
