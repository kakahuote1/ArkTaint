import { AppStorage, Prop, State, StorageProp, Want, taint } from "./taint_mock";

class ChildE2E005 {
    @Prop()
    title: string = "";

    build(): void {
        const mirror = this.title;
        taint.Sink(mirror);
    }
}

class ParentE2E005 {
    @StorageProp("token")
    tokenFromStorage: string = "";

    @State()
    title: string = "";

    onCreate(want: Want): void {
        AppStorage.set("token", want.parameters);
        const fromStorage = this.tokenFromStorage;
        this.title = fromStorage;
    }

    build(): void {
        const c = new ChildE2E005({ title: this.title });
        c.build();
    }
}

export function e2e_chain_cross_assign_005_T(): void {
    const p = new ParentE2E005();
    const w = new Want();
    w.parameters = "sensitive";
    p.onCreate(w);
    p.build();
}

