import axios from "@ohos/axios";
import { taint } from "./taint_mock";

export function transfer_import_scope_001_T(taint_src: string): void {
    const res = axios.get(taint_src);
    taint.Sink(res);
}
