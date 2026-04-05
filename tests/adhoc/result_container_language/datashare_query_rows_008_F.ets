import { DataShareHelper, taint } from "./taint_mock";

export function datashare_query_rows_008_F(taint_src: string): void {
    const helper = new DataShareHelper();
    helper.token_alt = taint_src;
    const rs = helper.querySqlSync("select token");
    taint.Sink(rs.getRows());
}
