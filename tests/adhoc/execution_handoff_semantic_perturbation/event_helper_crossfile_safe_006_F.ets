import { Button, taint } from "./taint_mock";
import { registerClickNested } from "./helpers";

export function event_helper_crossfile_safe_006_F(taint_src: string): void {
    const button = new Button();
    registerClickNested(button, () => {
        void taint_src;
        taint.Sink("safe");
    });
}
