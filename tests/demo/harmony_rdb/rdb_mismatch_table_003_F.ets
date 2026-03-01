import { RdbStore, taint } from "./taint_mock";

export function rdb_mismatch_table_003_F(taint_src: string): void {
    const db = new RdbStore();
    db.insert("a", { v: taint_src });
    const result = db.query("select v from b");
    taint.Sink(result);
}
