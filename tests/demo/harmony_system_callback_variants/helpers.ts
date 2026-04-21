import { WindowStage, WebView, taint } from "./taint_mock";

export function registerLoadContentExternal(stage: WindowStage, callback: (err: any, data: any) => void): void {
    stage.loadContent("ExternalPage", callback);
}

export function createLoadContentHandlerExternal(): (err: any, data: any) => void {
    return (_err: any, data: any) => {
        taint.Sink(data.token);
    };
}

export function registerWebMessageExternal(view: WebView, callback: (payload: any) => void): void {
    view.onMessage(callback);
}

export function createWebMessageHandlerExternal(): (payload: any) => void {
    return (payload: any) => {
        taint.Sink(payload.token);
    };
}
