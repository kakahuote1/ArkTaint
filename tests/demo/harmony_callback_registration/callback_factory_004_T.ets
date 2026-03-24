import { Button } from "./taint_mock";
import { createSinkingHandler } from "./helpers";

class CallbackPage004 {
    build(): void {
        const button = new Button();
        button.onClick(createSinkingHandler());
    }
}

export function callback_factory_004_T(): void {
    void CallbackPage004;
}

