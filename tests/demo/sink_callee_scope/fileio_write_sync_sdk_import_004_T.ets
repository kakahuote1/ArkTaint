import fileio from "@ohos.fileio";

export function fileio_write_sync_sdk_import_004_T(taint_src: string): void {
    const fd = 1;
    fileio.writeSync(fd, taint_src);
}
