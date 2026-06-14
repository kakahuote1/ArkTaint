import { Observed, State, taint } from "./taint_mock";

@Observed
class Message023 {
    content: string = "";
    role: string = "";
}

class Page023 {
    @State()
    messages: Message023[] = [];

    build(): void {
        const first = this.messages[0];
        taint.Sink(first.role);
    }
}

export function state_array_sibling_field_023_F(taint_src: string): void {
    const page = new Page023();
    const message = new Message023();
    message.content = taint_src;
    message.role = "user";
    page.messages.push(message);
    page.build();
}
