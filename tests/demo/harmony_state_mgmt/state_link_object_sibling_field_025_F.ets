import { Link, Observed, State, taint } from "./taint_mock";

@Observed
class Message025 {
    content: string = "";
    role: string = "";
}

class Child025 {
    @Link()
    message: Message025 = new Message025();

    build(): void {
        taint.Sink(this.message.role);
    }
}

class Parent025 {
    @State()
    message: Message025 = new Message025();

    build(): void {
        const child = new Child025({ message: this.message });
        child.build();
    }
}

export function state_link_object_sibling_field_025_F(taint_src: string): void {
    const p = new Parent025();
    p.message.content = taint_src;
    p.message.role = "user";
    p.build();
}
