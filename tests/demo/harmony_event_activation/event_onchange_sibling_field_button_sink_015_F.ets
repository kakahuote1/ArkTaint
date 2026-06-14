import { Button, UIInput, taint } from "./taint_mock";

class EventPage015 {
    private phone: string = "";
    private code: string = "";

    build(): void {
        const input = new UIInput();
        input.onChange((value: string): void => {
            this.phone = value;
        });

        const button = new Button();
        button.onClick((): void => {
            taint.Sink(this.code);
        });
    }
}

export function event_onchange_sibling_field_button_sink_015_F(): void {
    const page = new EventPage015();
    page.build();
}
