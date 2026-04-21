import { taint } from "./taint_mock";

export function transfer_field_path_002_F(taint_src: string) {
    const vault = new Map<string, string>();
    const writeKey = "other";
    const readKey = "secret";
    vault.set(writeKey, taint_src);
    const out = vault.get(readKey);
    taint.Sink(out);
}
