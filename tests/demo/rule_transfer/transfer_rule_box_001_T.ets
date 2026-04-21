import { taint } from "./taint_mock";

class Box001 {
    putData(v: string): void {
        let tmp = v;
        tmp = "safe";
    }

    get(): string {
        return "safe";
    }
}

export function transfer_rule_box_001_T(taint_src: string) {
    let box = new Box001();
    box.putData(taint_src);
    let out = box.get();
    taint.Sink(out);
}
