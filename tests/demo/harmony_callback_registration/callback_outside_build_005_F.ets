import { Button, taint } from "./taint_mock";

class CallbackPage005 {
    wire(): void {
        const button = new Button();
        button.onClick((payload) => {
            taint.Sink(payload);
        });
    }
}

export function callback_outside_build_005_F(): void {
    void CallbackPage005;
}

