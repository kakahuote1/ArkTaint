import { DistributedKVStore, taint } from "./taint_mock";

export function distributedkv_put_get_018_F(taint_src: string): void {
    const kv = new DistributedKVStore();
    kv.put("token_alt", taint_src);
    taint.Sink(kv.get("token"));
}
