import { Button, taint } from "./taint_mock";
import { registerClick } from "./helpers";

export function event_helper_samefile_capture_003_T(taint_src: string): void {
    const button = new Button();
    registerClick(button, () => {
        taint.Sink(taint_src);
    });
}
