import { Link, Observed, State, taint } from "./taint_mock";

@Observed
class Message024 {
    content: string = "";
    role: string = "";
}

class Child024 {
    @Link()
    message: Message024 = new Message024();

    build(): void {
        taint.Sink(this.message.content);
    }
}

class Parent024 {
    @State()
    message: Message024 = new Message024();

    build(): void {
        const child = new Child024({ message: this.message });
        child.build();
    }
}

export function state_link_object_content_field_024_T(taint_src: string): void {
    const p = new Parent024();
    p.message.content = taint_src;
    p.message.role = "user";
    p.build();
}
