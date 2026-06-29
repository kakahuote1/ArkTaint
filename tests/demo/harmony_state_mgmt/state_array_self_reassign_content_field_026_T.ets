import { Observed, State, taint } from "./taint_mock";

@Observed
class Message026 {
    content: string = "";
    role: string = "";
}

class Page026 {
    @State()
    message: Message026 = new Message026();

    normalize(): void {
        this.message = this.message;
    }

    build(): void {
        this.normalize();
        taint.Sink(this.message.content);
    }
}

export function state_array_self_reassign_content_field_026_T(taint_src: string): void {
    const page = new Page026();
    page.message.content = taint_src;
    page.message.role = "user";
    page.build();
}
