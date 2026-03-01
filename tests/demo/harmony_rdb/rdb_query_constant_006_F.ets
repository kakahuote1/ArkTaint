import { RdbStore, taint } from "./taint_mock";

export function rdb_query_constant_006_F(taint_src: string): void {
    const _u = taint_src;
    const db = new RdbStore();
    taint.Sink("safe");
    db.query("select 1");
}
