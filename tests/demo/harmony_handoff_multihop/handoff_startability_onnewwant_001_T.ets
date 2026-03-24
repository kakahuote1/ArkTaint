import { UIAbility, Want, taint } from "./taint_mock";

class Target001 extends UIAbility {
    onNewWant(want: Want): void {
        taint.Sink(want.payload);
    }
}

class Source001 extends UIAbility {
    onCreate(): void {
        this.context.startAbility(new Want(taint.Source()));
    }
}

export function handoff_startability_onnewwant_001_T(): void {
    void Source001;
    void Target001;
}

