// Case: FormExtensionAbility with full lifecycle
// Real pattern: home screen widget for smart home quick controls
import { FormExtensionAbility, FormBindingData, Want, taint } from "./taint_mock";

export default class SmartHomeWidget extends FormExtensionAbility {
    onAddForm(want: Want): FormBindingData {
        const formId = want.parameters?.["ohos.extra.param.key.form_identity"];
        const formName = want.parameters?.["ohos.extra.param.key.form_name"];
        taint.Sink(formId);
        taint.Sink(formName);

        const bindingData = new FormBindingData();
        bindingData.payload = JSON.stringify({
            temperature: "24°C",
            lights: "3 on",
        });
        return bindingData;
    }

    onUpdateForm(formId: string): void {
        taint.Sink(formId);
    }

    onRemoveForm(formId: string): void {
        taint.Sink(formId);
    }

    onFormEvent(formId: string, message: string): void {
        taint.Sink(formId);
        taint.Sink(message);
        this.handleWidgetAction(formId, message);
    }

    onAcquireFormState(want: Want): number {
        taint.Sink(want.parameters);
        return 0;
    }

    onCastToNormalForm(formId: string): void {
        taint.Sink(formId);
    }

    private handleWidgetAction(formId: string, action: string): void {
        taint.Sink(`Widget ${formId} action: ${action}`);
    }
}
