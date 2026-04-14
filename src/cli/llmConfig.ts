import * as fs from "fs";
import * as os from "os";
import * as path from "path";

declare const process: any;

export interface LlmProfileConfig {
    provider?: string;
    endpoint?: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
    apiKeyFile?: string;
    apiKeyEnv?: string;
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    minIntervalMs?: number;
    headers?: Record<string, string>;
    timeoutMs?: number;
    connectTimeoutMs?: number;
}

export interface LlmConfigFile {
    schemaVersion: 1;
    activeProfile: string;
    profiles: Record<string, LlmProfileConfig>;
}

export interface ResolvedLlmProfile {
    profileName: string;
    configPath: string;
    provider?: string;
    endpoint?: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
    apiKeySource: "inline" | "env" | "file";
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    minIntervalMs: number;
    headers: Record<string, string>;
    timeoutMs: number;
    connectTimeoutMs: number;
}

export interface ResolveLlmProfileOptions {
    configPath?: string;
    profile?: string;
    model?: string;
    requireApiKey?: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_MIN_INTERVAL_MS = 0;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}

function normalizeMaybeString(value: unknown): string | undefined {
    const normalized = String(value ?? "").trim();
    return normalized || undefined;
}

function normalizeMaybeStringPreserveEmpty(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    return String(value);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers || typeof headers !== "object") {
        return out;
    }
    for (const [key, value] of Object.entries(headers)) {
        const normalizedKey = String(key || "").trim();
        const normalizedValue = String(value ?? "").trim();
        if (!normalizedKey || !normalizedValue) {
            continue;
        }
        out[normalizedKey] = normalizedValue;
    }
    return out;
}

function normalizeProfile(profile: LlmProfileConfig): LlmProfileConfig {
    return {
        provider: normalizeMaybeString(profile.provider),
        endpoint: normalizeMaybeString(profile.endpoint),
        baseUrl: normalizeMaybeString(profile.baseUrl)?.replace(/\/+$/, ""),
        model: String(profile.model || "").trim(),
        apiKey: firstNonEmpty(profile.apiKey),
        apiKeyFile: firstNonEmpty(profile.apiKeyFile),
        apiKeyEnv: firstNonEmpty(profile.apiKeyEnv),
        apiKeyHeader: normalizeMaybeString(profile.apiKeyHeader),
        apiKeyPrefix: normalizeMaybeStringPreserveEmpty(profile.apiKeyPrefix),
        minIntervalMs: normalizePositiveInt(profile.minIntervalMs, DEFAULT_MIN_INTERVAL_MS),
        headers: normalizeHeaders(profile.headers),
        timeoutMs: normalizePositiveInt(profile.timeoutMs, DEFAULT_TIMEOUT_MS),
        connectTimeoutMs: normalizePositiveInt(profile.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    };
}

export function getDefaultLlmConfigPath(): string {
    return path.resolve(os.homedir(), ".arktaint", "llm.json");
}

export function getDefaultLlmSecretDir(configPath?: string): string {
    return path.resolve(path.dirname(resolveLlmConfigPath(configPath)), "secrets");
}

export function resolveLlmConfigPath(configPath?: string): string {
    return path.resolve(firstNonEmpty(configPath) || getDefaultLlmConfigPath());
}

function readApiKeyFile(secretPath: string | undefined): string | undefined {
    if (!secretPath) {
        return undefined;
    }
    const resolved = path.resolve(secretPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return undefined;
    }
    return firstNonEmpty(fs.readFileSync(resolved, "utf-8"));
}

function sanitizeSecretFileName(profileName: string): string {
    const normalized = profileName.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
    return normalized || "default";
}

export function writeLlmApiKeyFile(
    profileName: string,
    apiKey: string,
    configPath?: string,
    targetPath?: string,
): string {
    const secret = firstNonEmpty(apiKey);
    if (!secret) {
        throw new Error("LLM apiKey must not be empty");
    }
    const resolvedPath = path.resolve(
        targetPath || path.join(getDefaultLlmSecretDir(configPath), `${sanitizeSecretFileName(profileName)}.key`),
    );
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, `${secret}\n`, { encoding: "utf-8", mode: 0o600 });
    return resolvedPath;
}

export function readLlmConfigFile(configPath?: string): LlmConfigFile | undefined {
    const resolvedPath = resolveLlmConfigPath(configPath);
    if (!fs.existsSync(resolvedPath)) {
        return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`invalid LLM config: ${resolvedPath}`);
    }
    const rawProfiles = parsed.profiles;
    if (!rawProfiles || typeof rawProfiles !== "object" || Array.isArray(rawProfiles)) {
        throw new Error(`invalid LLM config profiles: ${resolvedPath}`);
    }
    const profiles: Record<string, LlmProfileConfig> = {};
    for (const [name, value] of Object.entries(rawProfiles)) {
        if (!name.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }
        profiles[name.trim()] = normalizeProfile(value as LlmProfileConfig);
    }
    const activeProfile = firstNonEmpty(parsed.activeProfile) || firstNonEmpty(...Object.keys(profiles)) || "default";
    return {
        schemaVersion: 1,
        activeProfile,
        profiles,
    };
}

export function writeLlmConfigFile(config: LlmConfigFile, configPath?: string): string {
    const resolvedPath = resolveLlmConfigPath(configPath);
    const payload: LlmConfigFile = {
        schemaVersion: 1,
        activeProfile: firstNonEmpty(config.activeProfile) || "default",
        profiles: {},
    };
    for (const [name, profile] of Object.entries(config.profiles || {})) {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) {
            continue;
        }
        const normalizedProfile = normalizeProfile(profile);
        if ((!normalizedProfile.endpoint && !normalizedProfile.baseUrl) || !normalizedProfile.model) {
            throw new Error(`invalid LLM profile "${normalizedName}": endpoint/baseUrl + model required`);
        }
        payload.profiles[normalizedName] = normalizedProfile;
    }
    if (!payload.profiles[payload.activeProfile]) {
        const firstProfile = Object.keys(payload.profiles)[0];
        if (firstProfile) {
            payload.activeProfile = firstProfile;
        }
    }
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(payload, null, 2), "utf-8");
    return resolvedPath;
}

export function resolveLlmProfile(options: ResolveLlmProfileOptions = {}): ResolvedLlmProfile | undefined {
    const configPath = resolveLlmConfigPath(options.configPath);
    const config = readLlmConfigFile(configPath);
    if (!config) {
        return undefined;
    }
    const profileName = firstNonEmpty(options.profile, config.activeProfile);
    if (!profileName) {
        return undefined;
    }
    const configuredProfile = config.profiles[profileName];
    if (!configuredProfile) {
        throw new Error(`LLM profile not found: ${profileName} (${configPath})`);
    }
    const apiKey = configuredProfile.apiKeyEnv
        ? firstNonEmpty(process.env[configuredProfile.apiKeyEnv], readApiKeyFile(configuredProfile.apiKeyFile), configuredProfile.apiKey)
        : firstNonEmpty(readApiKeyFile(configuredProfile.apiKeyFile), configuredProfile.apiKey);
    if (options.requireApiKey !== false && !apiKey) {
        throw new Error(
            `LLM apiKey missing for profile "${profileName}". ` +
            `Set ${configuredProfile.apiKeyEnv || configuredProfile.apiKeyFile || "apiKey"} or update ${configPath}`,
        );
    }
    const model = firstNonEmpty(options.model, configuredProfile.model);
    if (!model) {
        throw new Error(`LLM model missing for profile "${profileName}" (${configPath})`);
    }
    if (!configuredProfile.endpoint && !configuredProfile.baseUrl) {
        throw new Error(`LLM endpoint/baseUrl missing for profile "${profileName}" (${configPath})`);
    }
    return {
        profileName,
        configPath,
        provider: configuredProfile.provider,
        endpoint: configuredProfile.endpoint,
        baseUrl: configuredProfile.baseUrl,
        model,
        apiKey,
        apiKeySource: configuredProfile.apiKeyEnv
            ? "env"
            : configuredProfile.apiKeyFile
                ? "file"
                : "inline",
        apiKeyHeader: configuredProfile.apiKeyHeader,
        apiKeyPrefix: configuredProfile.apiKeyPrefix,
        minIntervalMs: normalizePositiveInt(configuredProfile.minIntervalMs, DEFAULT_MIN_INTERVAL_MS),
        headers: normalizeHeaders(configuredProfile.headers),
        timeoutMs: normalizePositiveInt(configuredProfile.timeoutMs, DEFAULT_TIMEOUT_MS),
        connectTimeoutMs: normalizePositiveInt(configuredProfile.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    };
}

export function sanitizeLlmConfigForDisplay(config: LlmConfigFile): Record<string, unknown> {
    const profiles: Record<string, unknown> = {};
    for (const [name, profile] of Object.entries(config.profiles || {})) {
        profiles[name] = {
            provider: profile.provider,
            endpoint: profile.endpoint,
            baseUrl: profile.baseUrl,
            model: profile.model,
            apiKeyEnv: profile.apiKeyEnv,
            apiKeyFile: profile.apiKeyFile,
            hasInlineApiKey: Boolean(profile.apiKey),
            apiKeyHeader: profile.apiKeyHeader,
            apiKeyPrefix: profile.apiKeyPrefix,
            minIntervalMs: profile.minIntervalMs,
            headers: normalizeHeaders(profile.headers),
            timeoutMs: profile.timeoutMs,
            connectTimeoutMs: profile.connectTimeoutMs,
        };
    }
    return {
        schemaVersion: config.schemaVersion,
        activeProfile: config.activeProfile,
        profiles,
    };
}
