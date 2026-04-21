import { Button, taint, registerClick } from "./taint_mock";

class EntryPage {
    build(): void {
        const button = new Button();
        registerClick(button, (payload) => {
            taint.Sink(payload);
        });
    }
}

export function onclick_helper_crossfile_010_T(): void {
    void EntryPage;
}
