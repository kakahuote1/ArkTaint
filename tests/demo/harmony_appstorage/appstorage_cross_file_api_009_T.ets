import { writeToken } from "./appstorage_cross_file_writer";
import { readTokenSink } from "./appstorage_cross_file_reader";

export function appstorage_cross_file_api_009_T(taint_src: string): void {
    writeToken(taint_src);
    readTokenSink();
}
