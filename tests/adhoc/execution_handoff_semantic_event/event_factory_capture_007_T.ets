import { Button } from "./taint_mock";
import { createSinkingHandler } from "./helpers";

export function event_factory_capture_007_T(taint_src: string): void {
    const button = new Button();
    button.onClick(createSinkingHandler(taint_src));
}
