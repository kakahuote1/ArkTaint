export const sendApi = (payload: string): void => {
  consume(payload);
}

export const otherApi = (payload: string): void => {
  consume(payload);
}

export function sendNamedApi(payload: string): void {
  consume(payload);
}

export function otherNamedApi(payload: string): void {
  consume(payload);
}

function consume(_value: string): void {
}

export function free_function_surface_send_001_T(taint_src: string): void {
  sendApi(taint_src);
}

export function free_function_surface_sibling_002_F(taint_src: string): void {
  otherApi(taint_src);
}

export function free_function_surface_named_003_T(taint_src: string): void {
  sendNamedApi(taint_src);
}

export function free_function_surface_named_sibling_004_F(taint_src: string): void {
  otherNamedApi(taint_src);
}
