import {
    CachePreferences,
    AppAccountManager,
    deviceInfo,
    deviceInfoProxy,
    DistributedKVStore,
    FileOperatorWrapper,
    fs,
    GlobalContext,
    Http,
    HttpClient,
    ChangeInfo,
    MyDistributedKVStore,
    MyRdbStore,
    PhotoViewPicker,
    Preferences,
    ProjectPhotoViewPicker,
    ProjectAccountManager,
    ProjectRemoteObject,
    RdbStore,
    RemoteObject,
    request,
    RequestAgentWrapper,
    asset,
    WebDataBase,
    WebDataBaseProxy,
    WebResourceRequest,
    WebResourceRequestProxy,
    cacheDownload,
    MessageParcel,
    ProjectAsset,
    ProjectMessageParcel,
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

export function api_appaccount_getcredential_016_T(): void {
    const manager = new AppAccountManager();
    const out = manager.getCredential("alice", "password");
    taint.Sink(out);
}

export function api_projectaccount_getcredential_017_F(): void {
    const manager = new ProjectAccountManager();
    const out = manager.getCredential("alice", "password");
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

export function api_webdatabase_getauth_018_T(): void {
    const db = new WebDataBase();
    const out = db.getHttpAuthCredentials("example.com", "admin");
    taint.Sink(out);
}

export function api_webdatabase_proxy_getauth_019_F(): void {
    const db = new WebDataBaseProxy();
    const out = db.getHttpAuthCredentials("example.com", "admin");
    taint.Sink(out);
}

export function api_rdb_changeinfo_inserted_020_T(): void {
    const info = new ChangeInfo();
    const out = info.inserted;
    taint.Sink(out);
}

export function api_request_downloadfile_021_T(): void {
    const out = request.downloadFile({}, { url: "https://example.com/file" });
    taint.Sink(out);
}

export function api_requestagentwrapper_downloadfile_022_F(): void {
    const out = RequestAgentWrapper.downloadFile({}, { url: "https://example.com/file" });
    taint.Sink(out);
}

export function api_request_cachedownload_023_T(): void {
    const out = cacheDownload.download({}, { url: "https://example.com/file" });
    taint.Sink(out);
}

export function api_rpc_sendrequest_reply_024_T(): void {
    const remote = new RemoteObject();
    const out = remote.sendRequest(1, {});
    taint.Sink(out);
}

export function api_rpc_sendmessagerequest_reply_025_T(): void {
    const remote = new RemoteObject();
    const out = remote.sendMessageRequest(1, {});
    taint.Sink(out);
}

export function api_projectremote_sendrequest_026_F(): void {
    const remote = new ProjectRemoteObject();
    const out = remote.sendRequest(1, {});
    taint.Sink(out);
}

export function api_webresource_request_url_027_T(): void {
    const req = new WebResourceRequest();
    const out = req.getRequestUrl();
    taint.Sink(out);
}

export function api_webresource_request_proxy_url_028_F(): void {
    const req = new WebResourceRequestProxy();
    const out = req.getRequestUrl();
    taint.Sink(out);
}

export function api_messageparcel_readstring_029_T(): void {
    const parcel = new MessageParcel();
    const out = parcel.readString();
    taint.Sink(out);
}

export function api_messageparcel_readexception_030_F(): void {
    const parcel = new MessageParcel();
    const out = parcel.readException();
    taint.Sink(out);
}

export function api_projectmessageparcel_readstring_031_F(): void {
    const parcel = new ProjectMessageParcel();
    const out = parcel.readString();
    taint.Sink(out);
}

export function api_security_asset_query_032_T(): void {
    const out = asset.query({ alias: "token" });
    taint.Sink(out);
}

export function api_project_asset_query_033_F(): void {
    const out = ProjectAsset.query({ alias: "token" });
    taint.Sink(out);
}

export function api_filepicker_select_034_T(): void {
    const picker = new PhotoViewPicker();
    const out = picker.select({ maxSelectNumber: 1 });
    taint.Sink(out);
}

export function api_project_filepicker_select_035_F(): void {
    const picker = new ProjectPhotoViewPicker();
    const out = picker.select({ maxSelectNumber: 1 });
    taint.Sink(out);
}

export function api_distributedkv_getentries_036_T(): void {
    const store = new DistributedKVStore();
    const out = store.getEntries("token");
    taint.Sink(out);
}

export function api_mydistributedkv_getentries_037_F(): void {
    const store = new MyDistributedKVStore();
    const out = store.getEntries("token");
    taint.Sink(out);
}
