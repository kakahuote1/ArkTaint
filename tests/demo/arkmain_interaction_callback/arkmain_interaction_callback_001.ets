import { ChannelSdk, FormExtensionAbility } from "./taint_mock";

class DemoInteractionFormExtension extends FormExtensionAbility {
    onUpdateForm(formId: string, params: Record<string, Object>): void {
        void formId;
        void params;
        ChannelSdk.subscribe((payload: string) => {
            console.info(payload);
        });
    }
}

export function arkmain_interaction_callback_001(): void {
    const extension = new DemoInteractionFormExtension();
    extension.onUpdateForm("form", {});
}
