import { taint } from "./taint_mock";

class InlineDb {
    update(bucket: any, predicates: any, callback: any) {
    }
}

export function sink_inline_transfer_payload_017_T() {
    const taint_src = taint.SourceReturn("html");
    const contentValue: any = {};
    contentValue.content = taint_src;
    const db = new InlineDb();
    db.update({ content: contentValue }, "id = ?", null);
}
