import { Button, UIInput, taint } from "./taint_mock";

class EventPage016 {
    private phone: string = "";
    private code: string = "";

    handleInputChange(value: string): void {
        this.phone = value;
    }

    submit(): void {
        taint.Sink(this.phone);
    }

    build(): void {
        const input = new UIInput();
        input.onChange(this.handleInputChange.bind(this));

        const button = new Button();
        button.onClick(this.submit.bind(this));
    }
}

export function event_onchange_bind_method_field_button_sink_016_T(): void {
    const page = new EventPage016();
    page.build();
}
