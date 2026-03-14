import { taint, Want } from "./taint_mock";

class AbilityNewWant003 {
    private pending: string = "";

    onNewWant(want: Want): void {
        this.pending = want.parameters;
    }

    flush(): void {
        taint.Sink(this.pending);
    }
}

export function lifecycle_newwant_field_003_T(): void {
    const ability = new AbilityNewWant003();
    const want = new Want();
    want.parameters = "new_want_message";
    ability.onNewWant(want);
    ability.flush();
}

