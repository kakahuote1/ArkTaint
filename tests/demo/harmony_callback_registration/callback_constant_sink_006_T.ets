import { Button } from "./taint_mock";
import { createConstantHandler } from "./helpers";

class CallbackPage006 {
    build(): void {
        const button = new Button();
        button.onClick(createConstantHandler());
    }
}

export function callback_constant_sink_006_T(): void {
    void CallbackPage006;
}

