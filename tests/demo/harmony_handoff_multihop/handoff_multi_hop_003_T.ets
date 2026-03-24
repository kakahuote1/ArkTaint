import { UIAbility, Want, taint } from "./taint_mock";

class Target003 extends UIAbility {
    onNewWant(want: Want): void {
        taint.Sink(want.payload);
    }
}

class Middle003 extends UIAbility {
    onNewWant(want: Want): void {
        this.context.startAbility(new Want(want.payload));
    }
}

class Source003 extends UIAbility {
    onCreate(): void {
        this.context.startAbility(new Want(taint.Source()));
    }
}

export function handoff_multi_hop_003_T(): void {
    void Source003;
    void Middle003;
    void Target003;
}

