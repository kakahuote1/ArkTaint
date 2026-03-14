import { taint, Want } from "./taint_mock";

class DemoFormExtension012 {
    onAddForm(payload: Want): void {
        taint.Sink(payload.parameters);
    }
}

export function lifecycle_extension_addform_name_mismatch_012_F(): void {
    const ext = new DemoFormExtension012();
    const want = new Want();
    want.parameters = "should_not_seed";
    ext.onAddForm(want);
}

