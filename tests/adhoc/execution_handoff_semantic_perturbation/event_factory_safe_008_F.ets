import { Button } from "./taint_mock";
import { createIgnoringHandler } from "./helpers";

export function event_factory_safe_008_F(taint_src: string): void {
    const button = new Button();
    button.onClick(createIgnoringHandler(taint_src));
}
