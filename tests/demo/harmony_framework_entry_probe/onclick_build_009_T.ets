import { Button, taint } from "./taint_mock";

class EntryPage {
    build(): void {
        const button = new Button();
        button.onClick((payload) => {
            taint.Sink(payload);
        });
    }
}

export function onclick_build_009_T(): void {
    void EntryPage;
}
