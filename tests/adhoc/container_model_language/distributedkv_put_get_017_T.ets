import { DistributedKVStore, taint } from "./taint_mock";

export function distributedkv_put_get_017_T(taint_src: string): void {
    const kv = new DistributedKVStore();
    kv.put("token", taint_src);
    taint.Sink(kv.get("token"));
}
