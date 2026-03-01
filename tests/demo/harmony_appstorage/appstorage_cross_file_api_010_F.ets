import { writeToken } from "./appstorage_cross_file_writer";
import { readSafeSink } from "./appstorage_cross_file_reader";

export function appstorage_cross_file_api_010_F(taint_src: string): void {
    writeToken(taint_src);
    readSafeSink();
}
