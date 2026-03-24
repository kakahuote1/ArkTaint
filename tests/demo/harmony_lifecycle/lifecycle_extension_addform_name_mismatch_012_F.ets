import { FormExtensionAbility, taint, Want } from "./taint_mock";

class DemoFormExtension012 extends FormExtensionAbility {
    onAddForms(payload: Want): void {
        taint.Sink(payload.parameters);
    }
}

export function lifecycle_extension_addform_name_mismatch_012_F(): void {
    const ext = new DemoFormExtension012();
    const want = new Want();
    want.parameters = "should_not_seed";
    ext.onAddForms(want);
}
