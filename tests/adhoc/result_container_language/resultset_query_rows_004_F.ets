import { RdbStore, taint } from "./taint_mock";

export function resultset_query_rows_004_F(taint_src: string): void {
    const db = new RdbStore();
    db.token_alt = taint_src;
    const rs = db.querySql("select token from t");
    taint.Sink(rs.getRows());
}
