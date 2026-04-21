import { taint, UIAbility, Want } from "./taint_mock";

class AbilityWantDirect001 extends UIAbility {
    onCreate(want: Want): void {
        taint.Sink(want.parameters);
    }
}

export function lifecycle_want_direct_001_T(): void {
    const ability = new AbilityWantDirect001();
    const want = new Want();
    want.parameters = "external_input";
    ability.onCreate(want);
}
