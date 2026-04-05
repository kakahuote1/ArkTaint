import { Button, taint } from "./taint_mock";

export function event_field_safe_010_F(taint_src: string): void {
    const button = new Button();
    const holder = {
        run: () => {
            void taint_src;
            taint.Sink("safe");
        },
    };
    const alias = holder;
    button.onClick(alias.run);
}
