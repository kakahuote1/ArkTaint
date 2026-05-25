import { taint } from "./taint_mock";

export function async_lock_request_scope_002_F(taint_src: string) {
    const lock = new taint.AsyncLockHost();
    lock.request(taint_src);
}
