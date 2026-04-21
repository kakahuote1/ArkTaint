import { AppStorage, Prop, State, StorageProp, UIInput, Want, taint } from "./taint_mock";

class ChildE2E001 {
    @Prop()
    title: string = "";

    build(): void {
        const snapshot = this.title;
        const cb = (value: string): void => {
            const _v = value;
            taint.Sink(snapshot);
        };
        const input = new UIInput();
        input.onChange(cb);
        taint.Sink(this.title);
    }
}

class ParentE2E001 {
    @StorageProp("token")
    tokenFromStorage: string = "";

    @State()
    title: string = "safe";

    onCreate(want: Want): void {
        AppStorage.set("token", want.parameters);
        this.title = this.tokenFromStorage;
    }

    build(): void {
        const child = new ChildE2E001({ title: this.title });
        child.build();
    }
}

export function e2e_chain_001_T(): void {
    const ability = new ParentE2E001();
    const want = new Want();
    want.parameters = "sensitive";
    ability.onCreate(want);
    ability.build();
}
