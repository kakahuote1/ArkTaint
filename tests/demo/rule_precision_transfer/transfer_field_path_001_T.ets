import { taint } from "./taint_mock";

export function transfer_field_path_001_T(taint_src: string) {
    const vault = new Map<string, string>();
    const key = "secret";
    vault.set(key, taint_src);
    const out = vault.get(key);
    taint.Sink(out);
}
