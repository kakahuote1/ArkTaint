import { RdbStore, taint } from "./taint_mock";

export function rdb_insert_query_alias_002_T(taint_src: string): void {
    const db = new RdbStore();
    db.insert("t", { v: taint_src });
    const result = db.query("select v from t");
    taint.Sink(result);
}
