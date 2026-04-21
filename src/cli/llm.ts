import * as readline from "readline";
import {
    getDefaultLlmConfigPath,
    LlmConfigFile,
    LlmProfileConfig,
    readLlmConfigFile,
    resolveLlmConfigPath,
    sanitizeLlmConfigForDisplay,
    writeLlmApiKeyFile,
    writeLlmConfigFile,
} from "./llmConfig";

declare const require: any;
declare const module: any;
declare const process: any;

interface LlmCliOptions {
    configPath?: string;
    printPath: boolean;
    show: boolean;
    interactive: boolean;
    profile: string;
    activate?: string;
    provider?: string;
    endpoint?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    promptKey: boolean;
    apiKeyEnv?: string;
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    minIntervalMs?: number;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    headers: Record<string, string>;
}

function readValue(argv: string[], index: number, flag: string): string | undefined {
    const current = argv[index];
    const next = index + 1 < argv.length ? argv[index + 1] : undefined;
    if (current === flag) {
        return next;
    }
    if (current.startsWith(`${flag}=`)) {
        return current.slice(flag.length + 1);
    }
    return undefined;
}

function normalizePositiveInt(raw: string | undefined, flag: string): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid ${flag}: ${raw}`);
    }
    return Math.floor(value);
}

function normalizeNonNegativeInt(raw: string | undefined, flag: string): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid ${flag}: ${raw}`);
    }
    return Math.floor(value);
}

function parseHeader(raw: string): [string, string] {
    const index = raw.indexOf("=");
    if (index <= 0 || index === raw.length - 1) {
        throw new Error(`invalid --header: ${raw}`);
    }
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!key || !value) {
        throw new Error(`invalid --header: ${raw}`);
    }
    return [key, value];
}

function parseArgs(argv: string[]): LlmCliOptions {
    let configPath: string | undefined;
    let printPath = false;
    let show = false;
    let interactive = false;
    let profile = "default";
    let activate: string | undefined;
    let provider: string | undefined;
    let endpoint: string | undefined;
    let baseUrl: string | undefined;
    let model: string | undefined;
    let apiKey: string | undefined;
    let promptKey = false;
    let apiKeyEnv: string | undefined;
    let apiKeyHeader: string | undefined;
    let apiKeyPrefix: string | undefined;
    let minIntervalMs: number | undefined;
    let timeoutMs: number | undefined;
    let connectTimeoutMs: number | undefined;
    const headers: Record<string, string> = {};

    for (let i = 0; i < argv.length; i++) {
        const configArg = readValue(argv, i, "--config");
        if (configArg !== undefined) {
            configPath = configArg;
            if (argv[i] === "--config") i++;
            continue;
        }
        if (argv[i] === "--printPath") {
            printPath = true;
            continue;
        }
        if (argv[i] === "--show") {
            show = true;
            continue;
        }
        if (argv[i] === "--interactive") {
            interactive = true;
            continue;
        }
        const profileArg = readValue(argv, i, "--profile");
        if (profileArg !== undefined) {
            profile = profileArg.trim() || "default";
            if (argv[i] === "--profile") i++;
            continue;
        }
        const activateArg = readValue(argv, i, "--activate");
        if (activateArg !== undefined) {
            activate = activateArg.trim();
            if (argv[i] === "--activate") i++;
            continue;
        }
        const providerArg = readValue(argv, i, "--provider");
        if (providerArg !== undefined) {
            provider = providerArg.trim();
            if (argv[i] === "--provider") i++;
            continue;
        }
        const endpointArg = readValue(argv, i, "--endpoint");
        if (endpointArg !== undefined) {
            endpoint = endpointArg.trim();
            if (argv[i] === "--endpoint") i++;
            continue;
        }
        const baseUrlArg = readValue(argv, i, "--baseUrl");
        if (baseUrlArg !== undefined) {
            baseUrl = baseUrlArg.trim();
            if (argv[i] === "--baseUrl") i++;
            continue;
        }
        const modelArg = readValue(argv, i, "--model");
        if (modelArg !== undefined) {
            model = modelArg.trim();
            if (argv[i] === "--model") i++;
            continue;
        }
        const apiKeyArg = readValue(argv, i, "--apiKey");
        if (apiKeyArg !== undefined) {
            apiKey = apiKeyArg;
            if (argv[i] === "--apiKey") i++;
            continue;
        }
        if (argv[i] === "--promptKey") {
            promptKey = true;
            continue;
        }
        const apiKeyEnvArg = readValue(argv, i, "--apiKeyEnv");
        if (apiKeyEnvArg !== undefined) {
            apiKeyEnv = apiKeyEnvArg.trim();
            if (argv[i] === "--apiKeyEnv") i++;
            continue;
        }
        const apiKeyHeaderArg = readValue(argv, i, "--apiKeyHeader");
        if (apiKeyHeaderArg !== undefined) {
            apiKeyHeader = apiKeyHeaderArg.trim();
            if (argv[i] === "--apiKeyHeader") i++;
            continue;
        }
        const apiKeyPrefixArg = readValue(argv, i, "--apiKeyPrefix");
        if (apiKeyPrefixArg !== undefined) {
            apiKeyPrefix = apiKeyPrefixArg;
            if (argv[i] === "--apiKeyPrefix") i++;
            continue;
        }
        const minIntervalArg = readValue(argv, i, "--minIntervalMs");
        if (minIntervalArg !== undefined) {
            minIntervalMs = normalizeNonNegativeInt(minIntervalArg, "--minIntervalMs");
            if (argv[i] === "--minIntervalMs") i++;
            continue;
        }
        const timeoutArg = readValue(argv, i, "--timeoutMs");
        if (timeoutArg !== undefined) {
            timeoutMs = normalizePositiveInt(timeoutArg, "--timeoutMs");
            if (argv[i] === "--timeoutMs") i++;
            continue;
        }
        const connectTimeoutArg = readValue(argv, i, "--connectTimeoutMs");
        if (connectTimeoutArg !== undefined) {
            connectTimeoutMs = normalizePositiveInt(connectTimeoutArg, "--connectTimeoutMs");
            if (argv[i] === "--connectTimeoutMs") i++;
            continue;
        }
        const headerArg = readValue(argv, i, "--header");
        if (headerArg !== undefined) {
            const [key, value] = parseHeader(headerArg);
            headers[key] = value;
            if (argv[i] === "--header") i++;
            continue;
        }
        if (argv[i].startsWith("--")) {
            throw new Error(`unknown option: ${argv[i]}`);
        }
    }

    return {
        configPath,
        printPath,
        show,
        interactive,
        profile,
        activate,
        provider,
        endpoint,
        baseUrl,
        model,
        apiKey,
        promptKey,
        apiKeyEnv,
        apiKeyHeader,
        apiKeyPrefix,
        minIntervalMs,
        timeoutMs,
        connectTimeoutMs,
        headers,
    };
}

function loadOrCreateConfig(configPath?: string): LlmConfigFile {
    return readLlmConfigFile(configPath) || {
        schemaVersion: 1,
        activeProfile: "default",
        profiles: {},
    };
}

function createReadline() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function askHidden(question: string): Promise<string> {
    return new Promise(resolve => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        if (!stdin.isTTY || !stdout.isTTY) {
            const rl = createReadline();
            rl.question(question, answer => {
                rl.close();
                resolve(answer.trim());
            });
            return;
        }
        stdout.write(question);
        stdin.resume();
        stdin.setEncoding("utf8");
        const wasRaw = Boolean((stdin as any).isRaw);
        stdin.setRawMode?.(true);
        let value = "";
        const startedAt = Date.now();
        let ignoredLeadingNewline = false;
        const finish = () => {
            stdout.write("\n");
            stdin.off("data", onData);
            stdin.setRawMode?.(wasRaw);
            stdin.pause();
            resolve(value.trim());
        };
        const onData = (chunk: string | Buffer) => {
            const text = String(chunk);
            for (const char of text) {
                if (char === "\u0003") {
                    stdout.write("\n");
                    stdin.off("data", onData);
                    stdin.setRawMode?.(wasRaw);
                    stdin.pause();
                    process.exit(1);
                }
                if (char === "\r" || char === "\n") {
                    if (!value && !ignoredLeadingNewline && Date.now() - startedAt < 250) {
                        ignoredLeadingNewline = true;
                        continue;
                    }
                    finish();
                    return;
                }
                if (char === "\b" || char === "\u007f") {
                    if (value.length > 0) {
                        value = value.slice(0, -1);
                        stdout.write("\b \b");
                    }
                    continue;
                }
                value += char;
                stdout.write("*");
            }
        };
        stdin.on("data", onData);
    });
}

async function askHiddenRequired(question: string): Promise<string> {
    for (;;) {
        const value = await askHidden(question);
        if (value) {
            return value;
        }
        console.error("API key must not be empty.");
    }
}

async function applyInteractiveInputs(
    options: LlmCliOptions,
    existing?: LlmProfileConfig,
): Promise<LlmCliOptions> {
    const current = existing || { endpoint: "", baseUrl: "", model: "", apiKeyHeader: "Authorization", apiKeyPrefix: "Bearer ", minIntervalMs: 0 };
    const rl = createReadline();
    try {
        if (!options.profile) {
            options.profile = (await ask(rl, `Profile [default]: `)) || "default";
        }
        if (options.endpoint === undefined) {
            options.endpoint = (await ask(rl, `Endpoint URL (preferred) [${current.endpoint || ""}]: `)) || current.endpoint;
        }
        if (!options.endpoint && options.baseUrl === undefined) {
            options.baseUrl = (await ask(rl, `Base URL [${current.baseUrl || ""}]: `)) || current.baseUrl;
        }
        if (!options.model) {
            options.model = (await ask(rl, `Model [${current.model || ""}]: `)) || current.model;
        }
        if (!options.provider) {
            options.provider = (await ask(rl, `Provider [${current.provider || ""}]: `)) || current.provider;
        }
        if (options.apiKeyHeader === undefined) {
            options.apiKeyHeader = (await ask(rl, `API key header [${current.apiKeyHeader || "Authorization"}]: `)) || current.apiKeyHeader || "Authorization";
        }
        if (options.apiKeyPrefix === undefined) {
            const prefix = await ask(rl, `API key prefix [${current.apiKeyPrefix ?? "Bearer "}]: `);
            options.apiKeyPrefix = prefix === "" ? (current.apiKeyPrefix ?? "Bearer ") : (prefix === "\"\"" ? "" : prefix);
        }
        if (options.minIntervalMs === undefined) {
            const raw = await ask(rl, `Min interval ms [${current.minIntervalMs ?? 0}]: `);
            options.minIntervalMs = raw === "" ? (current.minIntervalMs ?? 0) : normalizeNonNegativeInt(raw, "Min interval ms");
        }
        if (!options.apiKeyEnv && !options.apiKey && !options.promptKey) {
            const authMode = (await ask(rl, `Auth mode (file/env) [file]: `)).toLowerCase() || "file";
            if (authMode === "env") {
                options.apiKeyEnv = await ask(rl, `API key env var [${current.apiKeyEnv || ""}]: `) || current.apiKeyEnv;
            } else {
                options.promptKey = true;
            }
        }
    } finally {
        rl.close();
    }
    if (options.promptKey && !options.apiKey) {
        options.apiKey = await askHiddenRequired("API key: ");
    }
    return options;
}

function applyProfileUpdate(config: LlmConfigFile, options: LlmCliOptions): boolean {
    const hasProfileUpdate = Boolean(
        options.provider
        || options.endpoint !== undefined
        || options.baseUrl
        || options.model
        || options.apiKey !== undefined
        || options.apiKeyEnv !== undefined
        || options.apiKeyHeader !== undefined
        || options.apiKeyPrefix !== undefined
        || options.minIntervalMs !== undefined
        || options.timeoutMs !== undefined
        || options.connectTimeoutMs !== undefined
        || Object.keys(options.headers).length > 0,
    );
    if (!hasProfileUpdate) {
        if (options.activate) {
            if (!config.profiles[options.activate]) {
                throw new Error(`profile not found: ${options.activate}`);
            }
            config.activeProfile = options.activate;
            return true;
        }
        return false;
    }

    const current: LlmProfileConfig = config.profiles[options.profile] || {
        endpoint: "",
        baseUrl: "",
        model: "",
    };
    const next: LlmProfileConfig = {
        ...current,
        ...(options.provider !== undefined ? { provider: options.provider } : {}),
        ...(options.endpoint !== undefined ? { endpoint: options.endpoint || undefined } : {}),
        ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.apiKeyHeader !== undefined ? { apiKeyHeader: options.apiKeyHeader || undefined } : {}),
        ...(options.apiKeyPrefix !== undefined ? { apiKeyPrefix: options.apiKeyPrefix } : {}),
        ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.connectTimeoutMs !== undefined ? { connectTimeoutMs: options.connectTimeoutMs } : {}),
        ...(Object.keys(options.headers).length > 0
            ? { headers: { ...(current.headers || {}), ...options.headers } }
            : {}),
    };

    if (options.apiKeyEnv !== undefined) {
        next.apiKeyEnv = options.apiKeyEnv || undefined;
        next.apiKeyFile = undefined;
        next.apiKey = undefined;
    } else if (options.apiKey !== undefined) {
        next.apiKeyFile = writeLlmApiKeyFile(options.profile, options.apiKey, options.configPath);
        next.apiKeyEnv = undefined;
        next.apiKey = undefined;
    }

    config.profiles[options.profile] = next;
    config.activeProfile = options.activate || options.profile;
    return true;
}

function ensureProfileShape(profile: LlmProfileConfig, profileName: string): void {
    if ((!profile.endpoint && !profile.baseUrl) || !profile.model) {
        throw new Error(`profile "${profileName}" requires endpoint/baseUrl and model`);
    }
    if (!profile.apiKeyEnv && !profile.apiKeyFile && !profile.apiKey) {
        throw new Error(`profile "${profileName}" requires apiKeyEnv or apiKey`);
    }
}

export async function runLlmCli(argv: string[]): Promise<void> {
    let options = parseArgs(argv);
    const resolvedPath = resolveLlmConfigPath(options.configPath);

    if (options.printPath) {
        console.log(resolvedPath);
        return;
    }

    const config = loadOrCreateConfig(options.configPath);
    if (options.interactive) {
        options = await applyInteractiveInputs(options, config.profiles[options.profile]);
    } else if (options.promptKey && !options.apiKey) {
        options.apiKey = await askHiddenRequired("API key: ");
    }

    const updated = applyProfileUpdate(config, options);
    if (updated) {
        ensureProfileShape(config.profiles[options.profile], options.profile);
        const writtenPath = writeLlmConfigFile(config, options.configPath);
        console.log(`llm_config=${writtenPath}`);
    }

    const finalConfig = readLlmConfigFile(options.configPath) || config;
    console.log(JSON.stringify(sanitizeLlmConfigForDisplay(finalConfig), null, 2));
}

async function main(): Promise<void> {
    await runLlmCli(process.argv.slice(2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        console.error(`default_config_path=${getDefaultLlmConfigPath()}`);
        process.exitCode = 1;
    });
}
