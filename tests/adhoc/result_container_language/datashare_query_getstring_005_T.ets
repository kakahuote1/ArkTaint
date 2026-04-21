import { DataShareHelper, taint } from "./taint_mock";

export function datashare_query_getstring_005_T(taint_src: string): void {
    const helper = new DataShareHelper();
    helper.token = taint_src;
    const rs = helper.querySync("data://token");
    taint.Sink(rs.getString("token"));
}
