import { Button, taint } from "./taint_mock";

export function event_field_capture_009_T(taint_src: string): void {
    const button = new Button();
    const holder = {
        run: () => {
            taint.Sink(taint_src);
        },
    };
    const alias = holder;
    button.onClick(alias.run);
}
