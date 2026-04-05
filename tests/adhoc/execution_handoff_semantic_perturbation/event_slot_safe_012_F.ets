import { Button, taint } from "./taint_mock";

export function event_slot_safe_012_F(taint_src: string): void {
    const button = new Button();
    const handlers = [() => {
        void taint_src;
        taint.Sink("safe");
    }];
    const alias = handlers;
    button.onClick(alias[0]);
}
