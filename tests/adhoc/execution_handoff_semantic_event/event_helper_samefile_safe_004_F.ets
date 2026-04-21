import { Button, taint } from "./taint_mock";
import { registerClick } from "./helpers";

export function event_helper_samefile_safe_004_F(taint_src: string): void {
    const button = new Button();
    registerClick(button, () => {
        void taint_src;
        taint.Sink("safe");
    });
}
