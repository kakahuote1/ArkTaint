import { ButtonValue, taint } from "./taint_mock";

export function event_payload_param_004_T(taint_src: ButtonValue): void {
    taint_src.onValue((payload: string) => {
        taint.Sink(payload);
    });
}
