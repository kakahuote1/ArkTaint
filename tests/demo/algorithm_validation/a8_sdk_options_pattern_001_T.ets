import { animateTo, CustomDialogController, taint } from "./taint_mock";

export function a8_sdk_options_pattern_001_T(taint_src: string): void {
    const dialog = new CustomDialogController({
        builder: () => {},
        cancel: () => {},
        confirm: () => {
            taint.Sink(taint_src);
        },
    });
    dialog.open();

    animateTo({ duration: 200, onFinish: () => {
        taint.Sink(taint_src);
    } }, () => {});
}
