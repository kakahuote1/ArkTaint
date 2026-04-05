import { DataShareHelper, taint } from "./taint_mock";

export function datashare_query_rows_007_T(taint_src: string): void {
    const helper = new DataShareHelper();
    helper.token = taint_src;
    const rs = helper.querySqlSync("select token");
    taint.Sink(rs.getRows());
}
