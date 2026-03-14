import { RdbStore, taint } from "./taint_mock";

export function rdb_two_rows_005_T(taint_src: string): void {
    const db = new RdbStore();
    db.insert("t", { v: "safe" });
    db.insert("t", { v: taint_src });
    taint.Sink(db.query("select v from t"));
}
