import { AppStorage, Prop, State, StorageProp, UIInput, Want, taint } from "./taint_mock";

class ChildE2E003 {
    @Prop()
    title: string = "";

    build(): void {
        const input = new UIInput();
        input.onChange((value: string): void => {
            const _v = value;
            taint.Sink(this.title);
        });
    }
}

class ParentE2E003 {
    @StorageProp("token")
    tokenFromStorage: string = "";

    @State()
    title: string = "";

    onCreate(want: Want): void {
        AppStorage.setOrCreate("token", want.parameters);
        this.title = this.tokenFromStorage;
    }

    build(): void {
        const child = new ChildE2E003({ title: this.title });
        child.build();
    }
}

export function e2e_chain_storage_to_state_003_T(): void {
    const p = new ParentE2E003();
    const w = new Want();
    w.parameters = "sensitive";
    p.onCreate(w);
    p.build();
}
