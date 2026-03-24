import { taint, UIAbility, Want } from "./taint_mock";

class AbilityWantFieldBuild002 extends UIAbility {
    private cache: string = "safe";

    onCreate(want: Want): void {
        this.cache = want.parameters;
    }

    onForeground(): void {
        taint.Sink(this.cache);
    }
}

export function lifecycle_want_field_build_002_T(): void {
    const ability = new AbilityWantFieldBuild002();
    const want = new Want();
    want.parameters = "payload";
    ability.onCreate(want);
    ability.onForeground();
}
