import { taint } from "./taint_mock";

export function call_field_safe_016_F(taint_src: string): void {
    const holder = {
        run: () => {
            void taint_src;
            taint.Sink("safe");
        },
    };
    const alias = holder;
    alias.run();
}
