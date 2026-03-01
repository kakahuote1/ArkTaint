import { taint } from "./taint_mock";

class AbilityParamTypeMismatch007 {
    onCreate(want: string): void {
        taint.Sink(want);
    }
}

export function lifecycle_param_type_mismatch_007_F(): void {
    const ability = new AbilityParamTypeMismatch007();
    ability.onCreate("plain_text");
}

