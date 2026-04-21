import { taint } from "./taint_mock";

class Brush103 {
    attach(v: string): void {
        let t = v;
        t = "safe";
    }

    emit(dst: string): void {
        let localDst = dst;
        localDst = "safe";
    }
}

export function transfer_variant_base_to_arg0_103_T(taint_src: string) {
    let brush = new Brush103();
    brush.attach(taint_src);

    let clean = "safe";
    brush.emit(clean);
    taint.Sink(clean);
}

