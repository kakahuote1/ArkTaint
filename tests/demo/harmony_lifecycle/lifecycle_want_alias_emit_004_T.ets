import { taint, UIAbility, Want } from "./taint_mock";

class AbilityWantAlias004 extends UIAbility {
    onCreate(want: Want): void {
        const alias = want;
        const msg = alias.parameters;
        this.emit(msg);
    }

    private emit(value: string): void {
        taint.Sink(value);
    }
}

export function lifecycle_want_alias_emit_004_T(): void {
    const ability = new AbilityWantAlias004();
    const want = new Want();
    want.parameters = "alias";
    ability.onCreate(want);
}
