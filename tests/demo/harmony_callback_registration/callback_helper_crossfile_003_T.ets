import { Button, taint } from "./taint_mock";
import { registerClickNested } from "./helpers";

class CallbackPage003 {
    build(): void {
        const button = new Button();
        registerClickNested(button, (payload) => {
            taint.Sink(payload);
        });
    }
}

export function callback_helper_crossfile_003_T(): void {
    void CallbackPage003;
}

