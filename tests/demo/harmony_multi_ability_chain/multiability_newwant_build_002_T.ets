import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility002 extends UIAbility {
    private saved: string = "";

    onNewWant(want: Want): void {
        this.saved = want.token;
    }

    build(): void {
        taint.Sink(this.saved);
    }
}

class EntryPage002 {
    build(): void {
        new TargetAbility002().context.startAbilityForResult(new Want(taint.Source()));
    }
}

export function multiability_newwant_build_002_T(): void {
    void TargetAbility002;
    void EntryPage002;
}
