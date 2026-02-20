import { taint } from "./taint_mock";

export function transfer_compose_011_T(taint_src: string) {
    const box = new taint.ComposeBox();
    const out = box.Pipe(taint_src);
    taint.Sink(out);
}
