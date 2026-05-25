import { taint } from "./taint_mock";

class InlinePayloadBox {
    content: string = "";

    toBucket(): any {
        const bucket: any = {};
        bucket.content = this.content;
        return bucket;
    }
}

class InlineDb {
    update(bucket: any, predicates: any, callback: any) {
    }
}

export function sink_inline_transfer_payload_017_T() {
    const taint_src = taint.SourceReturn("html");
    const box = new InlinePayloadBox();
    box.content = taint_src;
    const db = new InlineDb();
    db.update(box.toBucket(), "id = ?", null);
}
