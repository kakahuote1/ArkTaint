import { taint } from "./taint_mock";

export function call_slot_capture_017_T(taint_src: string): void {
    const handlers = [() => {
        taint.Sink(taint_src);
    }];
    const alias = handlers;
    alias[0]();
}
