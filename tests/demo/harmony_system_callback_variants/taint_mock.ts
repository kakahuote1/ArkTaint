export const taint = {
    Sink(value: any): void {
        void value;
    },
};

export class WindowStage {
    loadContent(_page: string, callback: (err: any, data: any) => void): void {
        callback(null, { token: "window-token" });
    }
}

export class WebView {
    onMessage(callback: (payload: any) => void): void {
        callback({ token: "web-token" });
    }
}

export class FakeWindowStage {
    loadContent(_page: string, callback: (err: any, data: any) => void): void {
        callback(null, { token: "fake-window-token" });
    }
}

export class FakeWebView {
    onMessage(callback: (payload: any) => void): void {
        callback({ token: "fake-web-token" });
    }
}

export function registerLoadContent(stage: WindowStage, callback: (err: any, data: any) => void): void {
    stage.loadContent("MainPage", callback);
}

export function createLoadContentHandler(): (err: any, data: any) => void {
    return (_err: any, data: any) => {
        taint.Sink(data.token);
    };
}

export function registerWebMessage(view: WebView, callback: (payload: any) => void): void {
    view.onMessage(callback);
}

export function createWebMessageHandler(): (payload: any) => void {
    return (payload: any) => {
        taint.Sink(payload.token);
    };
}
