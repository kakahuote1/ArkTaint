import { DistributedKVStore, taint } from "./taint_mock";

class KvPage018 {
    build(): void {
        const kv = new DistributedKVStore();
        kv.put("token", taint.Source());
        taint.Sink(kv.get("token"));
    }
}

export function distributed_kv_018_T(): void {
    void KvPage018;
}
