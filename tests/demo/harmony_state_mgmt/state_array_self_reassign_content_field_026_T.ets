import { Observed, State, taint } from "./taint_mock";

@Observed
class Message026 {
    content: string = "";
    role: string = "";
}

class Page026 {
    @State()
    messages: Message026[] = [];

    normalize(): void {
        this.messages = this.messages.slice(0);
    }

    build(): void {
        this.normalize();
        const first = this.messages[0];
        taint.Sink(first.content);
    }
}

export function state_array_self_reassign_content_field_026_T(taint_src: string): void {
    const page = new Page026();
    const message = new Message026();
    message.content = taint_src;
    message.role = "user";
    page.messages.push(message);
    page.build();
}
