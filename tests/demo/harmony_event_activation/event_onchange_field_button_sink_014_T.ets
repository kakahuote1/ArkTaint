import { Button, UIInput, taint } from "./taint_mock";

class EventPage014 {
    private phone: string = "";

    build(): void {
        const input = new UIInput();
        input.onChange((value: string): void => {
            this.phone = value;
        });

        const button = new Button();
        button.onClick((): void => {
            taint.Sink(this.phone);
        });
    }
}

export function event_onchange_field_button_sink_014_T(): void {
    const page = new EventPage014();
    page.build();
}
