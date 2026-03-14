import { RdbStore, taint } from "./taint_mock";

export function rdb_insert_query_001_T(taint_src: string): void {
    const db = new RdbStore();
    db.insert("user", { token: taint_src });
    const rs = db.query("select token from user");
    taint.Sink(rs);
}
