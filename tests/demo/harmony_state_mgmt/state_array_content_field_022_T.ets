import { Observed, State, taint } from "./taint_mock";

@Observed
class Message022 {
    content: string = "";
    role: string = "";
}

class Page022 {
    @State()
    message: Message022 = new Message022();

    build(): void {
        taint.Sink(this.message.content);
    }
}

export function state_array_content_field_022_T(taint_src: string): void {
    const page = new Page022();
    page.message.content = taint_src;
    page.message.role = "user";
    page.build();
}
