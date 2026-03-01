import { taint, FormBindingData } from "./taint_mock";

class DemoFormExtension013 {
    onUpdateForm(formBindingData: FormBindingData): void {
        taint.Sink(formBindingData.payload);
    }
}

export function lifecycle_extension_formbinding_013_T(): void {
    const ext = new DemoFormExtension013();
    const data = new FormBindingData();
    data.payload = "binding_payload";
    ext.onUpdateForm(data);
}

