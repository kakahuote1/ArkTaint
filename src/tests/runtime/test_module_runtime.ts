import * as fs from "fs";
import * as path from "path";
import {
    defineModule,
} from "../../core/kernel/contracts/ModuleApi";
import {
    collectFiniteStringCandidatesFromValue,
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../../core/kernel/contracts/ModuleContract";
import { TaintFact } from "../../core/kernel/model/TaintFact";
import { loadModules } from "../../core/orchestration/modules/ModuleLoader";
import { createModuleRuntime } from "../../core/orchestration/modules/ModuleRuntime";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function writeProjectModuleFile(
    rootDir: string,
    projectId: string,
    fileName: string,
    lines: string[],
): string {
    const filePath = path.join(rootDir, "project", projectId, fileName);
    writeText(filePath, `${lines.join("\n")}\n`);
    return filePath;
}

function writeLooseModuleFile(
    rootDir: string,
    fileName: string,
    lines: string[],
): string {
    const filePath = path.join(rootDir, fileName);
    writeText(filePath, `${lines.join("\n")}\n`);
    return filePath;
}

async function main(): Promise<void> {
    const testRoot = path.resolve("tmp/test_runs/runtime/module_runtime/latest");
    const externalRoot = path.join(testRoot, "external_root");
    const runtimeRoot = path.join(testRoot, "runtime_root");
    const reloadRoot = path.join(testRoot, "reload_root");
    const nestedCwd = path.join(testRoot, "cwd_probe", "nested");
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(testRoot, { recursive: true });

    writeProjectModuleFile(externalRoot, "external_demo", "external_demo.ts", [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"external.custom_module\",",
        "  description: \"External project module fixture.\",",
        "});",
    ]);
    writeProjectModuleFile(externalRoot, "external_demo", "disabled_external.ts", [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"external.disabled_module\",",
        "  description: \"Disabled project module fixture.\",",
        "  enabled: false,",
        "});",
    ]);
    writeProjectModuleFile(externalRoot, "suppressed_demo", "suppressed.ts", [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"external.suppressed_module\",",
        "  description: \"Suppressed project module fixture.\",",
        "});",
    ]);
    const privateImportDir = path.join(externalRoot, "project", "private_demo");
    const privateSupportImport = path.relative(
        privateImportDir,
        path.resolve("src/core/orchestration/modules/ModuleRuntime"),
    ).replace(/\\/g, "/");
    writeProjectModuleFile(externalRoot, "private_demo", "private_demo.ts", [
        `import { defineModule } from "@arktaint/module";`,
        `import { createModuleRuntime } from "./${privateSupportImport}";`,
        "",
        "void createModuleRuntime;",
        "",
        "export default defineModule({",
        "  id: \"external.private_import_module\",",
        "  description: \"Should be rejected for importing private internals.\",",
        "});",
    ]);
    const loosePrivateSupportImport = path.relative(
        externalRoot,
        path.resolve("src/core/orchestration/modules/ModuleRuntime"),
    ).replace(/\\/g, "/");
    const loosePrivateImportModuleFile = writeLooseModuleFile(externalRoot, "private_loose.ts", [
        `import { defineModule } from "@arktaint/module";`,
        `import { createModuleRuntime } from "./${loosePrivateSupportImport}";`,
        "",
        "void createModuleRuntime;",
        "",
        "export default defineModule({",
        "  id: \"external.private_loose_import_module\",",
        "  description: \"Should be rejected for importing private internals via explicit file loading.\",",
        "});",
    ]);

    writeProjectModuleFile(runtimeRoot, "runtime_demo", "runtime_demo.ts", [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"fixture.runtime\",",
        "  description: \"Runtime fixture module.\",",
        "  setup() {",
        "    return {",
        "      onFact(event) {",
        "        return event.emit.toField(event.current.nodeId, [\"module\"], \"Fixture-Module\");",
        "      },",
        "      onInvoke(event) {",
        "        return event.emit.toField(event.current.nodeId, [\"invoke\"], \"Fixture-Invoke\");",
        "      },",
        "      shouldSkipCopyEdge() {",
        "        return true;",
        "      },",
        "    };",
        "  },",
        "});",
        "",
        "export const disabledInline = defineModule({",
        "  id: \"fixture.runtime.disabled_inline\",",
        "  description: \"Disabled inline module fixture.\",",
        "  enabled: false,",
        "  setup() {",
        "    throw new Error(\"disabled inline module should not run\");",
        "  },",
        "});",
    ]);

    const externalModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [externalRoot],
        enabledModuleProjects: ["external_demo"],
    });
    assert(externalModules.modules.length === 1, `expected 1 external module, got ${externalModules.modules.length}`);
    assert(externalModules.modules[0].id === "external.custom_module", "unexpected external module id");
    assert(
        !externalModules.modules.some(module => module.id === "external.disabled_module"),
        "file-disabled project modules should not be loaded",
    );
    assert(
        externalModules.discoveredModuleProjects.includes("external_demo"),
        "module loader should discover project folder names",
    );
    assert(
        externalModules.discoveredModuleProjects.includes("suppressed_demo"),
        "module loader should discover every project folder name even when not enabled",
    );
    assert(
        externalModules.discoveredModuleProjects.includes("private_demo"),
        "module loader should discover private-import project folders too",
    );
    assert(
        externalModules.enabledModuleProjects.includes("external_demo"),
        "module loader should report enabled project ids",
    );

    const privateImportModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [externalRoot],
        enabledModuleProjects: ["private_demo"],
    });
    assert(privateImportModules.modules.length === 0, "private-import project modules should be rejected");
    assert(
        privateImportModules.loadIssues.some(issue => issue.code === "MODULE_PROJECT_PRIVATE_IMPORT"),
        "private-import project modules should report a stable author-contract error code",
    );
    assert(
        privateImportModules.warnings.some(item => item.includes("project module private import rejected")),
        "private-import project modules should emit a clear loader warning",
    );

    const privateLooseImportModules = loadModules({
        includeBuiltinModules: false,
        moduleFiles: [loosePrivateImportModuleFile],
    });
    assert(privateLooseImportModules.modules.length === 0, "private-import explicit module files should be rejected");
    assert(
        privateLooseImportModules.loadIssues.some(issue => issue.code === "MODULE_PROJECT_PRIVATE_IMPORT"),
        "private-import explicit module files should report a stable author-contract error code",
    );
    assert(
        privateLooseImportModules.warnings.some(item => item.includes("project module private import rejected")),
        "private-import explicit module files should emit a clear loader warning",
    );

    const suppressedProjectModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [externalRoot],
        enabledModuleProjects: ["external_demo", "suppressed_demo"],
        disabledModuleProjects: ["suppressed_demo"],
    });
    assert(
        suppressedProjectModules.modules.length === 1
        && suppressedProjectModules.modules[0].id === "external.custom_module",
        "disabled project ids should suppress every module under that project",
    );

    const overrideExternalModule = defineModule({
        id: "external.custom_module",
        description: "override external module",
    });
    const overriddenExternalModules = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [externalRoot],
        enabledModuleProjects: ["external_demo"],
        modules: [overrideExternalModule],
    });
    assert(overriddenExternalModules.modules.length === 1, "explicit module object should replace duplicate project module id");
    assert(
        overriddenExternalModules.modules[0] === overrideExternalModule,
        "explicit module object should win over project module with the same id",
    );
    assert(
        overriddenExternalModules.warnings.some(w => w.includes("module id external.custom_module") && w.includes("overrides project module")),
        "overriding a loaded project module should emit a clear override warning",
    );

    const moduleResult = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [runtimeRoot],
        enabledModuleProjects: ["runtime_demo"],
    });
    assert(moduleResult.modules.length === 1, "expected exactly one runtime module");
    assert(moduleResult.modules[0].id === "fixture.runtime", "unexpected runtime module id");
    assert(moduleResult.loadedFiles.length === 1, "module loader should load exactly one runtime module file");
    assert(
        !moduleResult.modules.some(module => module.id === "fixture.runtime.disabled_inline"),
        "inline-disabled modules should not be loaded",
    );

    const reloadImportDir = reloadRoot;
    fs.mkdirSync(reloadImportDir, { recursive: true });
    const reloadModuleFile = writeLooseModuleFile(reloadRoot, "reloadable.ts", [
        `import { defineModule } from "@arktaint/module";`,
        "import { description } from \"./reload_desc\";",
        "",
        "export default defineModule({",
        "  id: \"fixture.reloadable\",",
        "  description,",
        "});",
    ]);
    const reloadDescFile = path.join(reloadRoot, "reload_desc.ts");
    const writeReloadFixture = (description: string): void => {
        writeText(reloadDescFile, `export const description = ${JSON.stringify(description)};\n`);
    };
    const tsRequireHookBefore = require.extensions[".ts"];
    writeReloadFixture("reload:v1");
    const reloadFirst = loadModules({
        includeBuiltinModules: false,
        moduleFiles: [reloadModuleFile],
    });
    writeReloadFixture("reload:v2");
    const reloadSecond = loadModules({
        includeBuiltinModules: false,
        moduleFiles: [reloadModuleFile],
    });
    assert(reloadFirst.modules[0]?.description === "reload:v1", "first fresh-loaded module should reflect initial dependency contents");
    assert(reloadSecond.modules[0]?.description === "reload:v2", "second fresh-loaded module should reflect updated dependency contents");
    assert(require.extensions[".ts"] === tsRequireHookBefore, "module loading should not mutate the process-wide .ts require hook");

    const builtinResult = loadModules({
        disabledModuleIds: ["harmony.router"],
    });
    assert(
        !builtinResult.modules.some(module => module.id === "harmony.router"),
        "disabled builtin module should not be present in load result",
    );
    assert(
        builtinResult.modules.some(module => module.id === "harmony.appstorage"),
        "builtin kernel modules should still be discoverable",
    );

    const disabledExternalResult = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [externalRoot],
        enabledModuleProjects: ["external_demo"],
        disabledModuleIds: ["external.custom_module"],
    });
    assert(disabledExternalResult.modules.length === 0, "disabled module ids should also disable project modules");

    const disabledInlineByIdResult = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [runtimeRoot],
        enabledModuleProjects: ["runtime_demo"],
        disabledModuleIds: ["fixture.runtime.disabled_inline"],
    });
    assert(
        disabledInlineByIdResult.warnings.length === 0,
        "disabling an inline-disabled module id should stay silent",
    );

    fs.mkdirSync(nestedCwd, { recursive: true });
    const originalCwd = process.cwd();
    let builtinFromNestedCwd;
    try {
        process.chdir(nestedCwd);
        builtinFromNestedCwd = loadModules({
            disabledModuleIds: ["harmony.router"],
        });
    } finally {
        process.chdir(originalCwd);
    }
    assert(
        builtinFromNestedCwd.modules.some(module => module.id === "harmony.appstorage"),
        "builtin modules should still resolve when cwd is not the project root",
    );
    assert(
        !builtinFromNestedCwd.modules.some(module => module.id === "harmony.router"),
        "disabled builtin module should remain disabled under nested cwd",
    );

    const builtinDeletionProbeSrcRoot = path.join(testRoot, "builtin_delete_probe_src");
    const builtinDeletionProbeRoot = path.join(builtinDeletionProbeSrcRoot, "src", "modules");
    fs.mkdirSync(builtinDeletionProbeSrcRoot, { recursive: true });
    writeText(
        path.join(builtinDeletionProbeRoot, "kernel", "harmony", "router.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"harmony.router\",",
            "  description: \"builtin delete probe router module\",",
            "});",
            "",
        ].join("\n"),
    );
    writeText(
        path.join(builtinDeletionProbeRoot, "kernel", "harmony", "appstorage.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"harmony.appstorage\",",
            "  description: \"builtin delete probe appstorage module\",",
            "});",
            "",
        ].join("\n"),
    );
    const routerModuleFile = path.join(builtinDeletionProbeRoot, "kernel", "harmony", "router.ts");
    fs.unlinkSync(routerModuleFile);
    const deletedBuiltinResult = loadModules({
        builtinModuleRoots: [builtinDeletionProbeRoot],
    });
    assert(
        !deletedBuiltinResult.modules.some(module => module.id === "harmony.router"),
        "physically deleting a builtin module file should remove that capability",
    );
    assert(
        deletedBuiltinResult.modules.some(module => module.id === "harmony.appstorage"),
        "remaining builtin modules should still load after one module file is removed",
    );

    const fakeNode = {
        getID() {
            return 7;
        },
    } as any;
    const queries = {
        resolveMethodsFromCallable,
        collectParameterAssignStmts,
        collectFiniteStringCandidatesFromValue,
    };
    const seedFact = new TaintFact(fakeNode, "fixture.source", 7);
    const runtime = createModuleRuntime(moduleResult.modules, {
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
    });
    const emissions = runtime.emitForFact({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
    });
    assert(runtime.listModuleIds().length === 1, "runtime should expose one module id");
    assert(emissions.length === 1, "module runtime should emit one fact");
    assert(emissions[0].reason === "Fixture-Module", "unexpected module emission reason");
    assert(emissions[0].fact.field?.join(".") === "module", "unexpected emitted fact field path");

    const invokeEmissions = runtime.emitForInvoke({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
        stmt: {
            containsInvokeExpr() {
                return true;
            },
        } as any,
        invokeExpr: {} as any,
        callSignature: "fixture.call",
        methodName: "fixtureMethod",
        declaringClassName: "FixtureClass",
        args: [],
        baseValue: undefined,
        resultValue: undefined,
    });
    assert(invokeEmissions.length === 1, "module runtime should emit one invoke fact");
    assert(invokeEmissions[0].reason === "Fixture-Invoke", "unexpected invoke emission reason");
    assert(invokeEmissions[0].fact.field?.join(".") === "invoke", "unexpected invoke emitted field path");
    assert(
        runtime.shouldSkipCopyEdge({
            scene: null as any,
            pag: null as any,
            node: fakeNode,
            contextId: 7,
        }),
        "module runtime should support copy-edge suppression",
    );

    const authorApiModule = defineModule({
        id: "fixture.author_api",
        description: "author api contract fixture",
        setup() {
            return {
                onFact(event) {
                    const emissions = event.emit.collector();
                    emissions.push(event.emit.toNode(event.current.nodeId, "Author-Generic"));
                    emissions.push(event.emit.preserveToNode(event.current.nodeId, "Author-Preserve"));
                    emissions.push(event.emit.toCurrentFieldTailNode(event.current.nodeId, "Author-Tail"));
                    emissions.push(event.emit.toFields([event.current.nodeId], ["explicit"], "Author-Explicit"));
                    return emissions.done();
                },
            };
        },
    });
    const authorApiRuntime = createModuleRuntime(
        [authorApiModule],
        {
            scene: null as any,
            pag: null as any,
            allowedMethodSignatures: undefined,
            fieldToVarIndex: new Map<string, Set<number>>(),
            queries,
            log: () => {},
        },
    );
    const authorApiFact = new TaintFact(fakeNode, "fixture.source", 11, ["root", "leaf"]);
    const authorApiEmissions = authorApiRuntime.emitForFact({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: authorApiFact,
        node: fakeNode,
    });
    const authorApiFieldByReason = new Map<string, string | undefined>(
        authorApiEmissions.map(item => [
            item.reason,
            item.fact.field ? item.fact.field.join(".") : undefined,
        ]),
    );
    assert(authorApiFieldByReason.get("Author-Generic") === undefined, "toNode should emit generic taint by default");
    assert(authorApiFieldByReason.get("Author-Preserve") === "root.leaf", "preserveToNode should preserve the full current field path");
    assert(authorApiFieldByReason.get("Author-Tail") === "leaf", "toCurrentFieldTailNode should emit the current field tail");
    assert(authorApiFieldByReason.get("Author-Explicit") === "explicit", "toFields should emit the explicit field path");

    const fakeCallbackValue = { __callback: true };
    const fakeCallbackLocal = {
        getName() {
            return "payload";
        },
    };
    const fakeCallbackParamStmt = {
        getLeftOp() {
            return fakeCallbackLocal;
        },
        getRightOp() {
            return {
                getIndex() {
                    return 0;
                },
            };
        },
        toString() {
            return "payload = @parameter0";
        },
    };
    const fakeCallbackMethodSignature = {
        toString() {
            return "@fixture/Callback.ets: CallbackOwner.invoke(string)";
        },
        getMethodSubSignature() {
            return {
                getMethodName() {
                    return "invoke";
                },
            };
        },
        getDeclaringClassSignature() {
            return {
                getClassName() {
                    return "CallbackOwner";
                },
            };
        },
    };
    const fakeCallbackMethod = {
        getSignature() {
            return fakeCallbackMethodSignature;
        },
        getName() {
            return "invoke";
        },
        getCfg() {
            return {
                getStmts() {
                    return [fakeCallbackParamStmt];
                },
            };
        },
    };
    const callbackQueries = {
        resolveMethodsFromCallable(_scene: any, value: any) {
            return value === fakeCallbackValue ? [fakeCallbackMethod] : [];
        },
        collectParameterAssignStmts(method: any) {
            return method === fakeCallbackMethod ? [fakeCallbackParamStmt] : [];
        },
        collectFiniteStringCandidatesFromValue(_scene: any, value: any) {
            return typeof value === "string" ? [value] : [];
        },
    };
    const callbackPag = {
        getNodesByValue(value: any) {
            if (value === fakeCallbackLocal) {
                return new Map<any, any>([[0, 701]]);
            }
            return new Map<any, any>();
        },
    } as any;
    let setupMethodsCount = 0;
    let setupBindingNodeId = -1;
    let setupStringCandidate = "";
    const setupAuthorApiModule = defineModule({
        id: "fixture.setup_author_api",
        description: "setup author api contract fixture",
        setup(ctx) {
            setupMethodsCount = ctx.callbacks.methods(fakeCallbackValue, { maxCandidates: 4 }).length;
            const bindings = ctx.callbacks.paramBindings(fakeCallbackValue, 0, { maxCandidates: 4 });
            setupBindingNodeId = bindings[0]?.localNodeIds?.()?.[0] ?? -1;
            setupStringCandidate = ctx.analysis.stringCandidates("ready")[0] || "";
        },
    });
    createModuleRuntime(
        [setupAuthorApiModule],
        {
            scene: {
                getMethods() {
                    return [fakeCallbackMethod];
                },
            } as any,
            pag: callbackPag,
            allowedMethodSignatures: undefined,
            fieldToVarIndex: new Map<string, Set<number>>(),
            queries: callbackQueries,
            log: () => {},
        },
    );
    assert(setupMethodsCount === 1, "setup callback method resolution should use public callback helpers");
    assert(setupBindingNodeId === 701, "setup callback param bindings should expose local node ids");
    assert(setupStringCandidate === "ready", "analysis.stringCandidates should expose setup-stage finite string candidates");

    let badModuleFactCalls = 0;
    const badSetupModule = defineModule({
        id: "fixture.bad_setup",
        description: "broken setup module",
        setup() {
            throw new Error("boom-setup");
        },
    });
    const badFactModule = defineModule({
        id: "fixture.bad_fact",
        description: "broken fact module",
        setup() {
            return {
                onFact() {
                    badModuleFactCalls++;
                    throw new Error("boom-fact");
                },
            };
        },
    });
    const isolatedRuntime = createModuleRuntime(
        [moduleResult.modules[0], badSetupModule, badFactModule],
        {
            scene: null as any,
            pag: null as any,
            allowedMethodSignatures: undefined,
            fieldToVarIndex: new Map<string, Set<number>>(),
            queries,
            log: () => {},
        },
    );
    const isolatedFirst = isolatedRuntime.emitForFact({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
    });
    const isolatedSecond = isolatedRuntime.emitForFact({
        scene: null as any,
        pag: null as any,
        allowedMethodSignatures: undefined,
        fieldToVarIndex: new Map<string, Set<number>>(),
        queries,
        log: () => {},
        fact: seedFact,
        node: fakeNode,
    });
    assert(isolatedFirst.length === 1, "failing modules should not suppress healthy module emissions");
    assert(isolatedSecond.length === 1, "disabled failing modules should stay isolated on later events");
    assert(badModuleFactCalls === 1, "failing module should be disabled after its first runtime failure");
    const isolatedAudit = isolatedRuntime.getAuditSnapshot();
    assert(
        isolatedAudit.failedModuleIds.includes("fixture.bad_setup") && isolatedAudit.failedModuleIds.includes("fixture.bad_fact"),
        "module runtime audit should expose failed module ids",
    );
    assert(
        isolatedAudit.failureEvents.some(event => event.moduleId === "fixture.bad_setup" && event.phase === "setup" && event.message.includes("boom-setup")),
        "module runtime audit should record setup failure details",
    );
    assert(
        isolatedAudit.failureEvents.some(event => event.moduleId === "fixture.bad_fact" && event.phase === "onFact" && event.message.includes("boom-fact")),
        "module runtime audit should record hook failure details",
    );

    console.log("PASS test_module_runtime");
    console.log(`external_module_count=${externalModules.modules.length}`);
    console.log(`builtin_module_count=${builtinResult.modules.length}`);
    console.log(`loaded_module_file=${path.basename(moduleResult.loadedFiles[0])}`);
    console.log(`loaded_module_extension=${path.extname(moduleResult.loadedFiles[0])}`);
}

main().catch((error) => {
    console.error("FAIL test_module_runtime");
    console.error(error);
    process.exit(1);
});
