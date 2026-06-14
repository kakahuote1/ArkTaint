import { Button, UIInput, taint } from "./taint_mock";

class EventPage019 {
    private phone: string = "";

    handleInputChange(value: string): void {
        this.phone = value;
    }

    helper(): void {
        const input = new UIInput();
        input.onChange(this.handleInputChange.bind(this));
    }

    submit(): void {
        taint.Sink(this.phone);
    }

    run(): void {
        this.helper();
        const button = new Button();
        button.onClick(this.submit.bind(this));
    }
}

export function event_onchange_non_builder_helper_scope_019_F(): void {
    const page = new EventPage019();
    page.run();
}
