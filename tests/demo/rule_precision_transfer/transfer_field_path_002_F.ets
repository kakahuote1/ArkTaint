import { taint } from "./taint_mock";

class Vault002 {
    PutSecret(v: string): void {
        let x = v;
        x = "safe";
    }

    PutOther(v: string): void {
        let y = v;
        y = "safe";
    }

    ReadSecret(): string {
        return "safe";
    }
}

export function transfer_field_path_002_F(taint_src: string) {
    const vault = new Vault002();
    vault.PutOther(taint_src);
    const out = vault.ReadSecret();
    taint.Sink(out);
}
