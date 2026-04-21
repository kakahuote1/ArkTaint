import { taint } from "./taint_mock";

export function implicit_safe_text_006_F(taint_src: string): void {
    const _u = taint_src;
    taint.Sink("safe");
}
