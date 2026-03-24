import { UIAbility, Want, taint } from "./taint_mock";

class Target002 extends UIAbility {
    onCreate(want: Want): void {
        taint.Sink(want.payload);
    }
}

class Source002 extends UIAbility {
    onCreate(): void {
        this.context.startAbilityForResult(new Want(taint.Source()));
    }
}

export function handoff_startability_for_result_002_T(): void {
    void Source002;
    void Target002;
}

