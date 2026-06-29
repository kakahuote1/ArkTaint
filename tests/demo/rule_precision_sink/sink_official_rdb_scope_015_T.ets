import { taint } from "./taint_mock";

export function sink_official_rdb_scope_015_T() {
    const taint_src = taint.SourceReturn("secret");
    const db = new taint.RdbStore();
    const contentTextValue: any = {};
    contentTextValue.content_text = taint_src;
    const values = { content_text: contentTextValue };
    db.update(values, "uuid=1", null);
}
