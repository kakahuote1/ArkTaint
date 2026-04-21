import { Button, createClickHandler } from "./taint_mock";

class EntryPage {
    build(): void {
        const button = new Button();
        button.onClick(createClickHandler());
    }
}

export function onclick_factory_011_T(): void {
    void EntryPage;
}
