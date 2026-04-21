import { taint } from "./taint_mock";

class LocalDialogController {
    constructor(options: { confirm?: () => void }) {
        void options;
    }

    open(): void {}
}

export function a8_sdk_options_pattern_002_F(taint_src: string): void {
    const dialog = new LocalDialogController({
        confirm: () => {
            taint.Sink(taint_src);
        },
    });
    dialog.open();
}
