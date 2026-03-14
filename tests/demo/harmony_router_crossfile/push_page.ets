import { Router } from "./taint_mock";

export function push_from_a(taint_src: string): void {
    Router.pushUrl({ url: "Detail", params: taint_src });
}

export function push_safe_from_a(): void {
    Router.pushUrl({ url: "Detail", params: "safe_literal" });
}
