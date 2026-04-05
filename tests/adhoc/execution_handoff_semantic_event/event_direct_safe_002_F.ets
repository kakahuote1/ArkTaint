import { Button, taint } from "./taint_mock";

export function event_direct_safe_002_F(taint_src: string): void {
    const button = new Button();
    button.onClick(() => {
        void taint_src;
        taint.Sink("safe");
    });
}
