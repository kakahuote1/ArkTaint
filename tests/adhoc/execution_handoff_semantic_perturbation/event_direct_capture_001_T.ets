import { Button, taint } from "./taint_mock";

export function event_direct_capture_001_T(taint_src: string): void {
    const button = new Button();
    button.onClick(() => {
        taint.Sink(taint_src);
    });
}
