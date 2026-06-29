import { taint } from "./taint_mock";

export function sink_official_rdb_scope_016_F() {
    const taint_src = taint.SourceReturn("secret");
    const contentTextValue: any = {};
    contentTextValue.content_text = taint_src;
    const values = { content_text: contentTextValue };
    taint.RdbStoreUtil.update(values, "uuid=1", null);
}
