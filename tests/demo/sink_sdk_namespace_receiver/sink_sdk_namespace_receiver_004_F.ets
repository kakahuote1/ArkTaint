class ProjectFile {
  writeSync(fd: number, data: ArrayBuffer): void {
    void fd;
    void data;
  }
}

function sink_sdk_namespace_receiver_004_F(input: ArrayBuffer): void {
  let taint_src = input;
  let file = new ProjectFile();
  file.writeSync(1, taint_src);
}
