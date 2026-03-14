import { taint, Want } from "./taint_mock";

class AbilityWantFieldBuild002 {
    private cache: string = "safe";

    onCreate(want: Want): void {
        this.cache = want.parameters;
    }

    build(): void {
        taint.Sink(this.cache);
    }
}

export function lifecycle_want_field_build_002_T(): void {
    const ability = new AbilityWantFieldBuild002();
    const want = new Want();
    want.parameters = "payload";
    ability.onCreate(want);
    ability.build();
}

