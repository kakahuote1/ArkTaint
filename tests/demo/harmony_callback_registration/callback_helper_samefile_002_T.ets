import { Button } from "./taint_mock";
import { registerClick } from "./helpers";
import { taint } from "./taint_mock";

class CallbackPage002 {
    build(): void {
        const button = new Button();
        registerClick(button, (payload) => {
            taint.Sink(payload);
        });
    }
}

export function callback_helper_samefile_002_T(): void {
    void CallbackPage002;
}
