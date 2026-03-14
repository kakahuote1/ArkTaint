import { taint, Want } from "./taint_mock";

class AbilityParamNameMismatch006 {
    onCreate(payload: Want): void {
        taint.Sink(payload.parameters);
    }
}

export function lifecycle_param_name_mismatch_006_F(): void {
    const ability = new AbilityParamNameMismatch006();
    const want = new Want();
    want.parameters = "name_mismatch";
    ability.onCreate(want);
}

