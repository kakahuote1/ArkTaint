import { FormExtensionAbility, taint, Want } from "./taint_mock";

class DemoFormExtension011 extends FormExtensionAbility {
    onAddForm(want: Want): void {
        taint.Sink(want.parameters);
    }
}

export function lifecycle_extension_addform_011_T(): void {
    const ext = new DemoFormExtension011();
    const want = new Want();
    want.parameters = "extension_want";
    ext.onAddForm(want);
}
