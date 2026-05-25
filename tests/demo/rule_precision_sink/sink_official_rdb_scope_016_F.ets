import { taint } from "./taint_mock";

export function sink_official_rdb_scope_016_F() {
    const taint_src = taint.SourceReturn("secret");
    taint.RdbStoreUtil.update({ content_text: taint_src }, "uuid=1", null);
}
