import { taint } from "./taint_mock";

export function call_slot_safe_018_F(taint_src: string): void {
    const handlers = [() => {
        void taint_src;
        taint.Sink("safe");
    }];
    const alias = handlers;
    alias[0]();
}
