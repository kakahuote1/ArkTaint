export const taint = {
    Source(): string {
        return "taint_src";
    },
    Sink(value: any): void {
        void value;
    },
};

export class Want {
    token: any;

    constructor(token: any) {
        this.token = token;
    }
}

export class AbilityContext {
    startAbility(want: any): void {
        void want;
    }

    startAbilityForResult(want: any): void {
        void want;
    }
}

export class UIAbility {
    context: AbilityContext = new AbilityContext();
}

export class BackupExtensionAbility {
}

export class UiExtensionAbility {
}

export class NavPathStack {
    getParams(): Record<string, any> {
        return { token: "nav-token" };
    }
}

export class GlobalContext {
    private static singleton = new GlobalContext();
    private storage = new Map<string, any>();

    static getContext(): GlobalContext {
        return GlobalContext.singleton;
    }

    setObject(key: string, value: any): void {
        this.storage.set(key, value);
    }

    getObject(key: string): any {
        return this.storage.get(key);
    }
}

export class DistributedKVStore {
    private kv = new Map<string, any>();

    put(key: string, value: any): void {
        this.kv.set(key, value);
    }

    get(key: string): any {
        return this.kv.get(key);
    }
}

export class WindowStage {
    loadContent(_page: string, callback: (err: any, data: any) => void): void {
        callback(null, { token: "stage-token" });
    }
}

export class WebView {
    onMessage(callback: (payload: any) => void): void {
        callback("webview-token");
    }
}

export class Button {
    onClick(callback: (payload: any) => void): void {
        callback("click-token");
    }
}

export function registerClick(button: Button, callback: (payload: any) => void): void {
    button.onClick(callback);
}

export function createClickHandler(): (payload: any) => void {
    return (payload: any) => {
        taint.Sink(payload);
    };
}
