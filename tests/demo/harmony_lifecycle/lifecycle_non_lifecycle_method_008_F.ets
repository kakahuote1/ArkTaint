import { taint, Want } from "./taint_mock";

class AbilityNonLifecycle008 {
    handleWant(want: Want): void {
        taint.Sink(want.parameters);
    }
}

export function lifecycle_non_lifecycle_method_008_F(): void {
    const ability = new AbilityNonLifecycle008();
    const want = new Want();
    want.parameters = "not_lifecycle";
    ability.handleWant(want);
}

