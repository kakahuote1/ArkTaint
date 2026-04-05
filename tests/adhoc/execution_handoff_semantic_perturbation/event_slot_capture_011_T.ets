import { Button, taint } from "./taint_mock";

export function event_slot_capture_011_T(taint_src: string): void {
    const button = new Button();
    const handlers = [() => {
        taint.Sink(taint_src);
    }];
    const alias = handlers;
    button.onClick(alias[0]);
}
