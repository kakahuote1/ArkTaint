import { Observed, State, taint } from "./taint_mock";

@Observed
class Message027 {
    content: string = "";
    role: string = "";
}

class Page027 {
    @State()
    messages: Message027[] = [];

    normalize(): void {
        this.messages = this.messages.slice(0);
    }

    build(): void {
        this.normalize();
        const first = this.messages[0];
        taint.Sink(first.role);
    }
}

export function state_array_self_reassign_sibling_field_027_F(taint_src: string): void {
    const page = new Page027();
    const message = new Message027();
    message.content = taint_src;
    message.role = "user";
    page.messages.push(message);
    page.build();
}
