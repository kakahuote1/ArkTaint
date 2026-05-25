import { taint } from "./taint_mock";

class LocalAxios {
    get(_value: string): string {
        return "safe";
    }
}

export function transfer_import_scope_002_F(taint_src: string): void {
    const localAxios = new LocalAxios();
    const res = localAxios.get(taint_src);
    taint.Sink(res);
}
