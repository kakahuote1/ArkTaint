const path = require("path");

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function normalizeSignature(method) {
    return String(method.getSignature().toString() || "").replace(/\\/g, "/");
}

function collectInvokeSignatures(method) {
    const cfg = method.getCfg && method.getCfg();
    if (!cfg) return [];
    const out = [];
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr && stmt.getInvokeExpr();
        if (!invokeExpr) continue;
        const sigObj = invokeExpr.getMethodSignature && invokeExpr.getMethodSignature();
        const sigText = sigObj && sigObj.toString ? String(sigObj.toString()) : "";
        if (sigText) out.push(sigText.replace(/\\/g, "/"));
    }
    return out;
}

async function main() {
    const arktanAnalyzerRoot = path.resolve(__dirname, "../../../Arktan/Arkanalyzer");
    const { Scene, SceneConfig, DummyMainCreater } = require(arktanAnalyzerRoot);

    const sourceDir = path.resolve(__dirname, "entry_component_mixing");
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const dmc = new DummyMainCreater(scene);
    const componentEntries = dmc.getEntryMethodsFromComponents();

    const normalized = componentEntries.map(m => normalizeSignature(m).toLowerCase());
    const pageBuild = componentEntries.find(m => {
        const sig = normalizeSignature(m).toLowerCase();
        return m.getName() === "build" && sig.includes("/pages/loginpage.ets");
    });
    const childBuild = componentEntries.find(m => {
        const sig = normalizeSignature(m).toLowerCase();
        return m.getName() === "build" && sig.includes("/components/passwordinput.ets");
    });

    assert(pageBuild, `Expected LoginPage.build in component entries, got:\n${normalized.join("\n")}`);
    assert(childBuild, `Expected PasswordInput.build in component entries, got:\n${normalized.join("\n")}`);

    const pageInvokeTargets = collectInvokeSignatures(pageBuild).map(x => x.toLowerCase());
    const pageInvokesBuild = pageInvokeTargets.some(sig => sig.includes(".build("));
    const pageInvokesSetPassword = pageInvokeTargets.some(sig => sig.includes(".setpassword("));
    assert(
        pageInvokesBuild,
        `Expected LoginPage.build to invoke some build() call, got invokes:\n${pageInvokeTargets.join("\n")}`
    );
    assert(
        pageInvokesSetPassword,
        `Expected LoginPage.build to invoke setPassword(), got invokes:\n${pageInvokeTargets.join("\n")}`
    );

    dmc.createDummyMain();
    const dummyMain = dmc.getDummyMain();
    const dummyInvokeTargets = collectInvokeSignatures(dummyMain).map(x => x.toLowerCase());
    const dummyInvokesPageBuild = dummyInvokeTargets.some(sig =>
        sig.includes("/pages/loginpage.ets") && sig.includes(".build(")
    );
    const dummyInvokesChildBuild = dummyInvokeTargets.some(sig =>
        sig.includes("/components/passwordinput.ets") && sig.includes(".build(")
    );
    const dummyInvokesSetPassword = dummyInvokeTargets.some(sig => sig.includes(".setpassword("));

    assert(
        dummyInvokesPageBuild && dummyInvokesChildBuild,
        `Expected dummy main to invoke both page and child build, got invokes:\n${dummyInvokeTargets.join("\n")}`
    );
    assert(
        !dummyInvokesSetPassword,
        `Expected dummy main NOT to invoke setPassword before direct child build, got invokes:\n${dummyInvokeTargets.join("\n")}`
    );

    console.log("PASS adhoc arktan entry-component mixing");
    console.log(`component_entries=${componentEntries.length}`);
    console.log(`contains_page_build=true`);
    console.log(`contains_child_build=true`);
    console.log(`page_invokes_build=true`);
    console.log(`page_invokes_setPassword=true`);
    console.log(`dummy_invokes_page_build=true`);
    console.log(`dummy_invokes_child_build=true`);
    console.log(`dummy_invokes_setPassword=false`);
    console.log("evidence=DummyMain invokes both page and child build directly; child direct invoke bypasses parent-only setPassword context.");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
