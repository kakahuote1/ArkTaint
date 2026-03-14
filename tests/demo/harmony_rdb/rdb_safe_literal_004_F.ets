import { RdbStore, taint } from "./taint_mock";

export function rdb_safe_literal_004_F(): void {
    const db = new RdbStore();
    db.insert("t", { v: "safe" });
    taint.Sink(db.query("select v from t"));
}
