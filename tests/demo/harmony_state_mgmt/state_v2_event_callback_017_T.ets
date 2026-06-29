import { taint } from "./taint_mock";

function dispatchResult017(handler: (data: string) => void, data: string): void {
    handler(data);
}

export function state_v2_event_callback_017_T(taint_src: string): void {
    dispatchResult017((data: string) => {
        taint.Sink(data);
    }, taint_src);
}
