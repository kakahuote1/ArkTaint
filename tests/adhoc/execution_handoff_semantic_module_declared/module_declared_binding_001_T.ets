import { UnknownAsync, taint } from "./taint_mock";

export function module_declared_binding_001_T(taint_src: string): void {
    const asyncObj = new UnknownAsync();
    asyncObj.onReady(() => {
        taint.Sink(taint_src);
    });
}
