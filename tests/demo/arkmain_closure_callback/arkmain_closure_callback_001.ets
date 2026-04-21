import { UIInput, State } from "./taint_mock";

@Entry
@Component
struct ClosurePage {
    @State token: string = "token";

    build() {
        const prefix = "ui:";
        const input = new UIInput();
        input.onClick(() => {
            const composed = `${prefix}${this.token}`;
            console.info(composed);
        });
    }
}

export function arkmain_closure_callback_001(): void {
    new ClosurePage().build();
}
