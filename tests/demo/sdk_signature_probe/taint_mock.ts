export const taint = {
    Source(): string {
        return "taint_src";
    },
    Sink(value: any): void {
        void value;
    }
};

export class Router {
    pushUrl(options: { url: string; params?: Record<string, any> }): void {
        void options;
    }

    replaceUrl(options: { url: string; params?: Record<string, any> }): void {
        void options;
    }

    pushNamedRoute(options: { name: string; params?: Record<string, any> }): void {
        void options;
    }

    getParams(): Record<string, any> {
        return { q: "router_param", id: "42" };
    }
}

export class NavPathStack {
    getParams(): Record<string, any> {
        return { nav: "param" };
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

export class EntryAbility {
    context: AbilityContext = new AbilityContext();

    onCreate(want: any): void {
        taint.Sink(want);
    }

    onNewWant(want: any): void {
        taint.Sink(want);
    }
}

export class UiExtensionAbility {
    onCreate(want: any): void {
        taint.Sink(want);
    }

    onNewWant(want: any): void {
        taint.Sink(want);
    }
}

export class BackupAbility {
    onRestore(payload: any): void {
        taint.Sink(payload);
    }
}

export class AbilityStage {
    onCreate(): any {
        return new SystemEnv().getContext();
    }
}

export class SystemEnv {
    getContext(): any {
        return { env: "ctx" };
    }
}

export class TextInput {
    onChange(callback: (value: any) => void): void {
        callback("onChange-input");
    }

    onInput(callback: (value: any) => void): void {
        callback("onInput-input");
    }

    onSubmit(callback: (value: any) => void): void {
        callback("onSubmit-input");
    }
}

export class WindowStage {
    loadContent(page: string, callback: (err: any, data: any) => void): void {
        void page;
        callback("loadContentErr", "loadContentData");
    }
}

export class WebView {
    onMessage(callback: (payload: any) => void): void {
        callback("webview-message");
    }
}

export class Http {
    request(url: string, data: any): any {
        return { url, data };
    }

    requestAsync(url: string, callback: (err: any, data: any) => void): void {
        callback(null, { url, async: true });
    }
}

export class HttpRequestTask {
    request(url: string, callback: (err: any, data: any) => void): void {
        callback(null, { url });
    }
}

export class axiosClient {
    get(url: string): any {
        return { url, via: "axios.get" };
    }

    post(url: string, data: any): any {
        return { url, data, via: "axios.post" };
    }
}

export class WebController {
    loadUrl(url: string): void {
        void url;
    }

    runJavaScript(script: string): void {
        void script;
    }
}

export class Web {
    create(url: string): void {
        void url;
    }

    static create(url: string): void {
        void url;
    }
}

export class RdbStore {
    executeSql(sql: string): void {
        void sql;
    }

    querySql(sql: string): string {
        return sql;
    }

    query(sql: string): string {
        return sql;
    }

    update(table: string, values: any, where: string): void {
        void table;
        void values;
        void where;
    }

    insert(table: string, values: any): void {
        void table;
        void values;
    }

    insertSync(table: string, values: any): void {
        void table;
        void values;
    }

    execDML(sql: string): void {
        void sql;
    }

    execDQL(sql: string): string {
        return sql;
    }
}

export class RdbStoreProxy extends RdbStore {
}

export class RelationalStore extends RdbStore {
}

export class Preferences {
    get(key: string, defaultValue: string): string {
        return defaultValue + key;
    }

    put(key: string, value: string): void {
        void key;
        void value;
    }

    getSync(key: string, defaultValue: string): string {
        return defaultValue + key;
    }

    putSync(key: string, value: string): void {
        void key;
        void value;
    }
}

export class DataPreferences extends Preferences {
}

export class GlobalContext {
    private storage = new Map<string, any>();
    private static singleton = new GlobalContext();

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

export class fs {
    read(path: string): string {
        return path;
    }

    readSync(path: string): string {
        return path;
    }

    write(path: string, value: any): void {
        void path;
        void value;
    }

    open(path: string): void {
        void path;
    }

    rename(from: string, to: string): void {
        void from;
        void to;
    }

    unlink(path: string): void {
        void path;
    }
}

export class Socket {
    connect(endpoint: string): void {
        void endpoint;
    }

    send(payload: any): void {
        void payload;
    }
}

export class request {
    download(url: string): string {
        return url;
    }

    upload(url: string, body: any): string {
        return `${url}:${String(body)}`;
    }
}

export class RequestAgent extends request {
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

export class EventHub {
    on(event: string, callback: (payload: any) => void): void {
        void event;
        void callback;
    }

    emit(event: string, payload: any): void {
        void event;
        void payload;
    }
}

export class hilog {
    info(domain: number, tag: string, fmt: string, payload: any): void {
        void domain;
        void tag;
        void fmt;
        void payload;
    }

    error(domain: number, tag: string, fmt: string, payload: any): void {
        void domain;
        void tag;
        void fmt;
        void payload;
    }
}

export class console {
    log(payload: any): void {
        void payload;
    }
}

export class HiLog {
    info(domain: number, tag: string, fmt: string, payload: any): void {
        void domain;
        void tag;
        void fmt;
        void payload;
    }

    error(domain: number, tag: string, fmt: string, payload: any): void {
        void domain;
        void tag;
        void fmt;
        void payload;
    }
}

export class JsonCodec {
    stringify(value: any): string {
        return `${value}`;
    }

    parse(text: string): any {
        return { text };
    }
}
