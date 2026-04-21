import { FakeButton, taint } from "./taint_mock";

class CallbackPage007 {
    build(): void {
        const button = new FakeButton();
        button.onClick((payload) => {
            taint.Sink(payload);
        });
    }
}

export function callback_fake_button_007_F(): void {
    void CallbackPage007;
}

