import { UIInput } from "./taint_mock";

function cbNoSink(value: string): void {
    const shadow = value;
    console.log(shadow);
}

class EventPage008 {
    build(): void {
        const input = new UIInput();
        input.onChange(cbNoSink);
    }
}

export function event_onchange_no_sink_008_F(): void {
    const page = new EventPage008();
    page.build();
}
