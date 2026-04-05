import { Button, taint } from "./taint_mock";
import { registerClickNested } from "./helpers";

export function event_helper_crossfile_capture_005_T(taint_src: string): void {
    const button = new Button();
    registerClickNested(button, () => {
        taint.Sink(taint_src);
    });
}
