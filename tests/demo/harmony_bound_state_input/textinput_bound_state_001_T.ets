import { taint } from "./taint_mock";

class BoundInputPage {
    phone: string = "";

    build(): void {
        TextInput({ text: $$this.phone, placeholder: "phone" });
        taint.Sink(this.phone);
    }
}

export function textinput_bound_state_001_T(): void {
    const page = new BoundInputPage();
    page.build();
}
