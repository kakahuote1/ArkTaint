import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility004 extends UIAbility {
    private saved: string = "";

    onCreate(want: Want): void {
        this.saved = want.token;
    }

    onBackground(): void {
        void this.saved;
    }

    onForeground(): void {
        taint.Sink(this.saved);
    }
}

class EntryPage004 {
    build(): void {
        new TargetAbility004().context.startAbility(new Want(taint.Source()));
    }
}

export function multiability_background_foreground_004_T(): void {
    void TargetAbility004;
    void EntryPage004;
}
