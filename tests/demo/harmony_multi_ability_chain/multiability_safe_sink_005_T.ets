import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility005 extends UIAbility {
    onCreate(want: Want): void {
        taint.Sink(want.token);
    }
}

class EntryPage005 {
    build(): void {
        new TargetAbility005().context.startAbility(new Want("clean"));
    }
}

export function multiability_safe_sink_005_T(): void {
    void TargetAbility005;
    void EntryPage005;
}
