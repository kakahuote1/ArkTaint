import { taint, Want } from "./taint_mock";

class AbilityWantUnused005 {
    onCreate(want: Want): void {
        const safe = "safe_literal";
        taint.Sink(safe);
    }
}

export function lifecycle_want_unused_005_F(): void {
    const ability = new AbilityWantUnused005();
    const want = new Want();
    want.parameters = "ignored";
    ability.onCreate(want);
}

