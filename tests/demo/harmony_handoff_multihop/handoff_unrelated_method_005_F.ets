import { UIAbility, Want, taint } from "./taint_mock";

class Target005 extends UIAbility {
    receive(want: Want): void {
        taint.Sink(want.payload);
    }
}

class Source005 extends UIAbility {
    onCreate(): void {
        this.context.startAbility(new Want(taint.Source()));
    }
}

export function handoff_unrelated_method_005_F(): void {
    void Source005;
    void Target005;
}

