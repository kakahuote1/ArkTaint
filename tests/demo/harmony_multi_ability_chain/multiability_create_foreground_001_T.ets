import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility001 extends UIAbility {
    private saved: string = "";

    onCreate(want: Want): void {
        this.saved = want.token;
    }

    onForeground(): void {
        taint.Sink(this.saved);
    }
}

class EntryPage001 {
    build(): void {
        new TargetAbility001().context.startAbility(new Want(taint.Source()));
    }
}

export function multiability_create_foreground_001_T(): void {
    const entry = new EntryPage001();
    entry.build();
    void TargetAbility001;
}
