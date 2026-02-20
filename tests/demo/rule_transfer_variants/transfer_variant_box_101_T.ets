import { taint } from "./taint_mock";

class Vault101 {
    stash(v: string): void {
        let tmp = v;
        tmp = "safe";
    }

    read(): string {
        return "safe";
    }
}

export function transfer_variant_box_101_T(taint_src: string) {
    let vault = new Vault101();
    vault.stash(taint_src);
    let out = vault.read();
    taint.Sink(out);
}

