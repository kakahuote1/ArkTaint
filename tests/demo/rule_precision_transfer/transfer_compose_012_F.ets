import { taint } from "./taint_mock";

export function transfer_compose_012_F(taint_src: string) {
    const box = new taint.ComposeBox();
    const out = box.Pipe("safe");
    taint.Sink(out);
}
