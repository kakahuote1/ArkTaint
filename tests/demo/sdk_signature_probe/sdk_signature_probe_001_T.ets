import {
    taint,
    AbilityStage,
    BackupAbility,
    DataPreferences,
    DistributedKVStore,
    EntryAbility,
    EventHub,
    GlobalContext,
    HiLog,
    Http,
    JsonCodec,
    NavPathStack,
    Preferences,
    RdbStore,
    RdbStoreProxy,
    RelationalStore,
    RequestAgent,
    Router,
    Socket,
    TextInput,
    UiExtensionAbility,
    Web,
    WebController,
    WebView,
    WindowStage,
    axiosClient,
    console,
    fs,
    hilog,
    request
} from "./taint_mock";

function sdk_signature_probe_001_T(userInput: string): void {
    const seed = taint.Source() + userInput;

    // Router + lifecycle + stage sources
    const router = new Router();
    router.pushUrl({ url: "Detail", params: { q: seed } });
    router.replaceUrl({ url: "Detail2", params: { q: seed } });
    router.pushNamedRoute({ name: "NamedDetail", params: { q: seed } });
    const params = router.getParams();
    const navParams = new NavPathStack().getParams();

    const ability = new EntryAbility();
    ability.onCreate({ want: seed });
    ability.onNewWant({ want: seed });
    const extension = new UiExtensionAbility();
    extension.onCreate({ want: seed });
    extension.onNewWant({ want: seed });
    new BackupAbility().onRestore({ backup: seed });
    const stageCtx = new AbilityStage().onCreate();

    // Input + callback sources
    const input = new TextInput();
    input.onChange((v) => taint.Sink(v));
    input.onInput((v) => taint.Sink(v));
    input.onSubmit((v) => taint.Sink(v));

    const windowStage = new WindowStage();
    windowStage.loadContent("MainPage", (err, data) => {
        taint.Sink(err);
        taint.Sink(data);
    });

    const webView = new WebView();
    webView.onMessage((payload) => {
        taint.Sink(payload);
    });

    // Network + axios
    const http = new Http();
    const httpRes = http.request("https://example.com/api", { body: seed });
    http.requestAsync("https://example.com/async", (err, data) => {
        if (!err) taint.Sink(data?.url);
    });

    const axios = new axiosClient();
    const axiosResGet = axios.get("https://example.com/axios-get?q=" + seed);
    const axiosResPost = axios.post("https://example.com/axios-post", { body: seed });

    // WebView sinks
    const webCtrl = new WebController();
    webCtrl.loadUrl(String(params["q"]) + seed);
    webCtrl.runJavaScript("alert('" + seed + "')");
    const web = new Web();
    web.create("https://example.com/web?x=" + seed);
    Web.create("https://example.com/web?x=" + seed);

    // DB sinks/transfers
    const rdb = new RdbStore();
    rdb.executeSql("select * from t where q='" + seed + "'");
    const q1 = rdb.querySql("select * from t");
    const q2 = rdb.query("select * from t2");
    rdb.update("users", { name: seed }, "id=1");
    rdb.insert("users", { name: seed });
    rdb.insertSync("users", { name: seed });
    rdb.execDML("delete from t where id=1");
    const q3 = rdb.execDQL("select * from users");

    const rdbProxy = new RdbStoreProxy();
    rdbProxy.executeSql("update t set c='" + seed + "'");

    const rel = new RelationalStore();
    rel.querySql("select * from rel");

    // Preferences + DataPreferences
    const prefs = new Preferences();
    prefs.put("k", seed);
    prefs.putSync("k2", seed);
    const prefValue = prefs.get("k", "default");
    const prefSyncValue = prefs.getSync("k2", "default2");

    const dataPrefs = new DataPreferences();
    dataPrefs.put("dk", seed);
    dataPrefs.getSync("dk", "dv");

    // GlobalContext
    const ctx = GlobalContext.getContext();
    ctx.setObject("token", seed);
    const fromCtx = ctx.getObject("token");

    // File sinks/sources
    const file = new fs();
    file.write("/tmp/a.txt", seed);
    file.open("/tmp/a.txt");
    file.rename("/tmp/a.txt", "/tmp/b.txt");
    file.unlink("/tmp/b.txt");
    const fileRead = file.read("/tmp/c.txt");
    const fileReadSync = file.readSync("/tmp/d.txt");

    // Ability sinks
    ability.context.startAbility({ target: "MainAbility", payload: seed });
    ability.context.startAbilityForResult({ target: "SubAbility", payload: seed });

    // Socket sinks
    const sock = new Socket();
    sock.connect("wss://example.com?x=" + seed);
    sock.send(seed);

    // Request sinks/sources/transfers
    const req = new request();
    const dl = req.download("https://example.com/file?id=" + seed);
    const up = req.upload("https://example.com/upload", { payload: seed });

    const reqAgent = new RequestAgent();
    reqAgent.download("https://example.com/file2?id=" + seed);
    reqAgent.upload("https://example.com/upload2", { payload: seed });

    // Distributed KV
    const dkv = new DistributedKVStore();
    dkv.put("k", seed);
    const kvValue = dkv.get("k");

    // Event hub (for emitter coverage)
    const hub = new EventHub();
    hub.on("login", (payload) => {
        taint.Sink(payload);
    });
    hub.emit("login", seed);

    // HiLog sinks (A/B/C tiers)
    const logA = new HiLog();
    logA.info(0, "probe", "%{public}s", seed);
    logA.error(0, "probe", "%{public}s", seed);

    const logC = new hilog();
    logC.info(0, "probe", "%{public}s", seed);
    logC.error(0, "probe", "%{public}s", seed);

    const logConsole = new console();
    logConsole.log(seed);

    // JSON transfers (A/B/C tiers)
    const jsonCodec = new JsonCodec();
    const serializedA = jsonCodec.stringify(params);
    const parsedA = jsonCodec.parse(serializedA);

    const serializedC = JSON.stringify({ seed, stageCtx });
    const parsedC = JSON.parse(serializedC);

    const concatenated = "prefix-".concat(seed);

    // Code injection sinks
    eval("void('" + seed + "')");
    const fn = new Function("x", "return x + '';");
    taint.Sink(fn(seed));

    // Final sinks to materialize dataflow
    taint.Sink(params["q"]);
    taint.Sink(navParams["nav"]);
    taint.Sink(httpRes?.data);
    taint.Sink(axiosResGet?.url);
    taint.Sink(axiosResPost?.data);
    taint.Sink(q1);
    taint.Sink(q2);
    taint.Sink(q3);
    taint.Sink(prefValue);
    taint.Sink(prefSyncValue);
    taint.Sink(fromCtx);
    taint.Sink(fileRead);
    taint.Sink(fileReadSync);
    taint.Sink(dl);
    taint.Sink(up);
    taint.Sink(kvValue);
    taint.Sink(parsedA["text"]);
    taint.Sink(parsedC["seed"]);
    taint.Sink(concatenated);
}
