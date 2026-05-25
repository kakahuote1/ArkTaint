import { taint } from "./taint_mock";

export function sink_official_rdb_scope_015_T() {
    const taint_src = taint.SourceReturn("secret");
    const db = new taint.RdbStore();
    db.update({ content_text: taint_src }, "uuid=1", null);
}
