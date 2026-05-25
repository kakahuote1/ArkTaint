import { Observed, State, taint } from "./taint_mock";

@Observed
class Note021 {
    content: string = "";
    uuid: string = "";
}

class Page021 {
    @State()
    note: Note021 = new Note021();

    build(): void {
        const localNote = this.note;
        taint.Sink(localNote.uuid);
    }
}

export function state_local_sibling_field_021_F(taint_src: string): void {
    const page = new Page021();
    page.note.content = taint_src;
    page.note.uuid = "safe";
    page.build();
}
