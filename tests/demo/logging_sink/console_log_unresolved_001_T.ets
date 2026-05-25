export function console_log_unresolved_001_T(taint_src: string) {
  const payload = { phone: taint_src };
  const serialized = JSON.stringify(payload);
  console.log(serialized);
  console.info(serialized);
}
