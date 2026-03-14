import { spawnSync, SpawnSyncOptionsWithStringEncoding } from "child_process";

export interface ProcessRunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export interface ProcessRunResultWithError extends ProcessRunResult {
    errorMessage?: string;
}

function buildErrorMessage(
    label: string,
    result: ProcessRunResult,
    errorMessage?: string
): string {
    if (errorMessage && errorMessage.length > 0) {
        return `${label} spawn error: ${errorMessage}`;
    }
    return `${label} failed: status=${result.status}, stderr=${result.stderr || ""}`;
}

export function runCommandOrThrow(
    label: string,
    executable: string,
    args: string[],
    options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding"> = {}
): ProcessRunResult {
    const cmd = spawnSync(executable, args, {
        encoding: "utf-8",
        ...options,
    });
    const result: ProcessRunResult = {
        status: cmd.status,
        stdout: cmd.stdout || "",
        stderr: cmd.stderr || "",
    };
    if (cmd.error) {
        throw new Error(buildErrorMessage(label, result, cmd.error.message));
    }
    if (cmd.status !== 0) {
        throw new Error(buildErrorMessage(label, result));
    }
    return result;
}

export function runShellOrThrow(
    label: string,
    commandLine: string,
    options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "shell"> = {}
): ProcessRunResult {
    return runCommandOrThrow(label, commandLine, [], {
        shell: true,
        ...options,
    });
}

export function runShell(
    commandLine: string,
    options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "shell"> = {}
): ProcessRunResultWithError {
    const cmd = spawnSync(commandLine, [], {
        encoding: "utf-8",
        shell: true,
        ...options,
    });
    return {
        status: cmd.status,
        stdout: cmd.stdout || "",
        stderr: cmd.stderr || "",
        errorMessage: cmd.error?.message,
    };
}
