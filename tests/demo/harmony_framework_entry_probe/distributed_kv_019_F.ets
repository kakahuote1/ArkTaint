import { DistributedKVStore, taint } from "./taint_mock";

class KvPage019 {
    build(): void {
        const kvWrite = new DistributedKVStore();
        kvWrite.put("token", taint.Source());
        const kvRead = new DistributedKVStore();
        taint.Sink(kvRead.get("token"));
    }
}

export function distributed_kv_019_F(): void {
    void KvPage019;
}
