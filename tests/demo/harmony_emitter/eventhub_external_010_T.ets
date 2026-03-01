import { taint } from "./taint_mock";

interface ExternalEventHub {
    on(event: string, cb: (data: any) => void): void;
    emit(event: string, data: any): void;
}

declare const externalHub: ExternalEventHub;

export function eventhub_external_010_T(taint_src: string): void {
    externalHub.on("login", (payload: string): void => {
        taint.Sink(payload);
    });
    externalHub.emit("login", taint_src);
}

