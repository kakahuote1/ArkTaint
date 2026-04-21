import { AppStorage, Prop, State, StorageProp, Want, taint } from "./taint_mock";

class ChildE2E004 {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class ParentE2E004 {
    @StorageProp("token")
    tokenFromStorage: string = "";

    @State()
    title: string = "";

    onCreate(want: Want): void {
        AppStorage.set("token", want.parameters);
        this.title = this.tokenFromStorage;
    }

    build(): void {
        const child = new ChildE2E004({ title: this.title });
        child.title = "safe";
    }
}

export function e2e_chain_no_build_004_F(): void {
    const p = new ParentE2E004();
    const w = new Want();
    w.parameters = "sensitive";
    p.onCreate(w);
    p.build();
}

