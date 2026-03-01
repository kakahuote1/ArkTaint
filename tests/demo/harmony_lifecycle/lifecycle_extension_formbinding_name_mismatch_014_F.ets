import { taint, FormBindingData } from "./taint_mock";

class DemoFormExtension014 {
    onUpdateForm(data: FormBindingData): void {
        taint.Sink(data.payload);
    }
}

export function lifecycle_extension_formbinding_name_mismatch_014_F(): void {
    const ext = new DemoFormExtension014();
    const data = new FormBindingData();
    data.payload = "name_mismatch";
    ext.onUpdateForm(data);
}

