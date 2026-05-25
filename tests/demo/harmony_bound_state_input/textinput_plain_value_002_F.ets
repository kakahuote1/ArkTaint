import { taint } from "./taint_mock";

class PlainInputPage {
    phone: string = "";

    build(): void {
        TextInput({ text: this.phone, placeholder: "phone" });
        taint.Sink(this.phone);
    }
}

export function textinput_plain_value_002_F(): void {
    const page = new PlainInputPage();
    page.build();
}
