import {
    CachePreferences,
    deviceInfo,
    deviceInfoProxy,
    DistributedKVStore,
    FileOperatorWrapper,
    fs,
    GlobalContext,
    Http,
    HttpClient,
    MyDistributedKVStore,
    MyRdbStore,
    Preferences,
    RdbStore,
    request,
    RequestAgentWrapper,
    taint,
} from "./taint_mock";

export function api_http_request_001_T(): void {
    const client = new Http();
    const out = client.request("https://example");
    taint.Sink(out);
}

export function api_httpclient_request_002_F(): void {
    const client = new HttpClient();
    const out = client.request("https://example");
    taint.Sink(out);
}

export function api_preferences_get_003_T(): void {
    const prefs = new Preferences();
    const out = prefs.get("token");
    taint.Sink(out);
}

export function api_cachepreferences_get_004_F(): void {
    const prefs = new CachePreferences();
    const out = prefs.get("token");
    taint.Sink(out);
}

export function api_rdb_query_005_T(): void {
    const store = new RdbStore();
    const out = store.query("select *");
    taint.Sink(out);
}

export function api_myrdb_query_006_F(): void {
    const store = new MyRdbStore();
    const out = store.query("select *");
    taint.Sink(out);
}

export function api_globalcontext_getobject_007_T(): void {
    const ctx = new GlobalContext();
    const out = ctx.getObject("token");
    taint.Sink(out);
}

export function api_fs_read_008_T(): void {
    const file = new fs();
    const out = file.read("/tmp/data");
    taint.Sink(out);
}

export function api_fileoperatorwrapper_read_009_F(): void {
    const file = new FileOperatorWrapper();
    const out = file.read("/tmp/data");
    taint.Sink(out);
}

export function api_request_download_010_T(): void {
    const agent = new request();
    const out = agent.download("https://example");
    taint.Sink(out);
}

export function api_requestagentwrapper_download_011_F(): void {
    const agent = new RequestAgentWrapper();
    const out = agent.download("https://example");
    taint.Sink(out);
}

export function api_distributedkv_get_012_T(): void {
    const store = new DistributedKVStore();
    const out = store.get("token");
    taint.Sink(out);
}

export function api_mydistributedkv_get_013_F(): void {
    const store = new MyDistributedKVStore();
    const out = store.get("token");
    taint.Sink(out);
}

export function api_deviceinfo_udid_014_T(): void {
    const info = new deviceInfo();
    const out = info.udid;
    taint.Sink(out);
}

export function api_deviceinfoproxy_udid_015_F(): void {
    const info = new deviceInfoProxy();
    const out = info.udid;
    taint.Sink(out);
}
