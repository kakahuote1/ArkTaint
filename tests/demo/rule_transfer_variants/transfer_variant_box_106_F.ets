import { taint } from "./taint_mock";

class Vault106 {
    stash(v: string): void {
        let tmp = v;
        tmp = "safe";
    }

    read(): string {
        return "safe";
    }
}

export function transfer_variant_box_106_F(taint_src: string) {
    let vault = new Vault106();
    vault.stash("clean");
    let out = vault.read();
    taint.Sink(out);
}

