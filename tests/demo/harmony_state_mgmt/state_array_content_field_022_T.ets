import { Observed, State, taint } from "./taint_mock";

@Observed
class Message022 {
    content: string = "";
    role: string = "";
}

class Page022 {
    @State()
    messages: Message022[] = [];

    build(): void {
        const first = this.messages[0];
        taint.Sink(first.content);
    }
}

export function state_array_content_field_022_T(taint_src: string): void {
    const page = new Page022();
    const message = new Message022();
    message.content = taint_src;
    message.role = "user";
    page.messages.push(message);
    page.build();
}
