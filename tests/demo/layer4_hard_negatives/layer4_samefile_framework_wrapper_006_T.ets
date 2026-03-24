import { Button, taint } from "./taint_mock";

function registerFrameworkClick(button: Button, handler: (payload: any) => void): void {
    button.onClick(handler);
}

@Entry
@Component
class Layer4WrapperControlPage {
    build(): void {
        const button = new Button();
        registerFrameworkClick(button, (payload) => {
            taint.Sink(payload);
        });
    }
}

export function layer4_samefile_framework_wrapper_006_T(): void {
    void Layer4WrapperControlPage;
}
