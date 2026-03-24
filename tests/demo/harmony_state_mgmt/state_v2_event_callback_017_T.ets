import { Event, taint } from "./taint_mock";

class EventChild017 {
    @Event()
    onResult: (data: string) => void = () => {};

    report(data: string): void {
        this.onResult(data);
    }
}

export function state_v2_event_callback_017_T(taint_src: string): void {
    const child = new EventChild017({
        onResult: (data: string) => {
            taint.Sink(data);
        },
    });
    child.report(taint_src);
}
