import { Button, UIInput, taint } from "./taint_mock";

function Builder(_target: any, _key?: string, _desc?: any): void {}

class EventPage018 {
    private phone: string = "";

    handleInputChange(value: string): void {
        this.phone = value;
    }

    submit(): void {
        taint.Sink(this.phone);
    }

    @Builder
    LoginForm(): void {
        const input = new UIInput();
        input.onChange(this.handleInputChange.bind(this));

        const button = new Button();
        button.onClick(this.submit.bind(this));
    }

    build(): void {
        this.LoginForm();
    }
}

export function event_onchange_decorated_builder_method_field_button_sink_018_T(): void {
    const page = new EventPage018();
    page.build();
}
