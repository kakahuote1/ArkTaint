import { RdbStore, taint } from "./taint_mock";

export function resultset_query_getstring_001_T(taint_src: string): void {
    const db = new RdbStore();
    db.token = taint_src;
    const rs = db.query("select token from t");
    taint.Sink(rs.getString("token"));
}
