import { taint } from "./taint_mock";

class Box006 {
    putData(v: string): void {
        let tmp = v;
        tmp = "safe";
    }

    get(): string {
        return "safe";
    }
}

export function transfer_rule_box_006_F(taint_src: string) {
    let box = new Box006();
    box.putData("clean");
    let out = box.get();
    taint.Sink(out);
}
