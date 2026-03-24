import { UIAbility, taint } from "./taint_mock";

class TargetAbility006 extends UIAbility {
    helper(): void {
        taint.Sink("clean");
    }
}

export function multiability_unrelated_006_F(): void {
    void TargetAbility006;
}
