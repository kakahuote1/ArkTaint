import { UIAbility, Want, taint } from "./taint_mock";

class Target004 extends UIAbility {
    onNewWant(want: Want): void {
        void want;
        taint.Sink("safe");
    }
}

class Source004 extends UIAbility {
    onCreate(): void {
        this.context.startAbility(new Want(taint.Source()));
    }
}

export function handoff_safe_sink_004_T(): void {
    void Source004;
    void Target004;
}

