import fileio from '@ohos.file.fs';

function sink_sdk_namespace_receiver_003_T(input: ArrayBuffer): void {
  let taint_src = input;
  fileio.writeSync(1, taint_src);
}
