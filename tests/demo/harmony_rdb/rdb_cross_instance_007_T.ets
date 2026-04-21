import { RdbStore, taint } from "./taint_mock";

export function rdb_cross_instance_007_T(taint_src: string): void {
    const db1 = new RdbStore();
    const db2 = new RdbStore();
    db1.insert("t", { v: taint_src });
    taint.Sink(db2.query("select v from t"));
}
