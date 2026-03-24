import { Button, taint } from "./taint_mock";

class CallbackPage001 {
    build(): void {
        const button = new Button();
        button.onClick((payload) => {
            taint.Sink(payload);
        });
    }
}

export function callback_direct_build_001_T(): void {
    void CallbackPage001;
}

