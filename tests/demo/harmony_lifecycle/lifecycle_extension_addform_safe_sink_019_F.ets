import { FormExtensionAbility, Want, taint } from "./taint_mock";

class FormExt019 extends FormExtensionAbility {
    onAddForm(want: Want): void {
        const _unused = want.parameters;
        taint.Sink("safe");
    }
}

export function lifecycle_extension_addform_safe_sink_019_F(): void {
    const ext = new FormExt019();
    const w = new Want();
    w.parameters = "tainted";
    ext.onAddForm(w);
}
