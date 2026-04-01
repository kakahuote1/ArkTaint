import { taint } from "./taint_mock";

export function call_field_capture_015_T(taint_src: string): void {
    const holder = {
        run: () => {
            taint.Sink(taint_src);
        },
    };
    const alias = holder;
    alias.run();
}
