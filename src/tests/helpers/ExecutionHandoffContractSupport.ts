import * as fs from "fs";
import * as path from "path";
import { buildTestScene } from "./TestSceneBuilder";

type SceneLike = any;
type MethodLike = any;

export interface ParamBinding {
    local: string;
    index: number;
    raw: string;
}

export function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

export function getScene(relativeDir: string): SceneLike {
    return buildTestScene(path.resolve(relativeDir));
}

export function findMethod(scene: SceneLike, signatureNeedle: string): MethodLike {
    const methods = scene
        .getMethods()
        .filter((m: MethodLike) => (m.getSignature?.().toString?.() || "").includes(signatureNeedle));
    assert(methods.length > 0, `expected method containing "${signatureNeedle}"`);
    return methods[0];
}

export function methodSignature(method: MethodLike): string {
    return method.getSignature?.().toString?.() || method.getName?.() || "<unknown-method>";
}

export function findMethodByStmt(scene: SceneLike, needle: string): MethodLike {
    const methods = scene.getMethods().filter((method: MethodLike) => {
        const cfg = method.getCfg?.();
        if (!cfg) {
            return false;
        }
        return cfg.getStmts().some((stmt: any) => stmt.toString().includes(needle));
    });
    assert(methods.length > 0, `expected method with stmt containing "${needle}"`);
    return methods[0];
}

export function stmtTexts(method: MethodLike): string[] {
    const cfg = method.getCfg?.();
    assert(!!cfg, `method has no cfg: ${method.getSignature?.().toString?.() || method.getName?.()}`);
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

export function findInvokeStmt(method: MethodLike, needle: string): any {
    const cfg = method.getCfg?.();
    assert(!!cfg, `method has no cfg: ${method.getSignature?.().toString?.() || method.getName?.()}`);
    const stmt = cfg.getStmts().find((s: any) => s.toString().includes(needle));
    assert(!!stmt, `expected invoke stmt containing "${needle}"`);
    return stmt;
}

export function paramBindings(method: MethodLike): ParamBinding[] {
    const regex = /^\s*([^=\s]+)\s*=\s*parameter(\d+):/;
    return stmtTexts(method)
        .map(raw => {
            const match = raw.match(regex);
            if (!match) {
                return undefined;
            }
            return {
                local: match[1],
                index: Number(match[2]),
                raw,
            };
        })
        .filter((item): item is ParamBinding => !!item);
}

export function payloadBindings(method: MethodLike): ParamBinding[] {
    return paramBindings(method).filter(binding => !binding.local.startsWith("%closures"));
}

export function captureBindings(method: MethodLike): ParamBinding[] {
    return paramBindings(method).filter(binding => binding.local.startsWith("%closures"));
}

export function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

let isolatedCaseViewCounter = 0;

function buildUniqueSuffix(): string {
    const counter = isolatedCaseViewCounter++;
    return `${process.pid}_${Date.now()}_${counter}`;
}

export function meaningfulFutureUnits(scene: SceneLike, fileNeedle?: string): MethodLike[] {
    return scene.getMethods().filter((method: MethodLike) => {
        const signature = methodSignature(method);
        if (!signature.includes("%AM")) {
            return false;
        }
        if (signature.includes("taint_mock.ts")) {
            return false;
        }
        if (fileNeedle && !signature.includes(fileNeedle)) {
            return false;
        }
        const cfg = method.getCfg?.();
        return !!cfg && cfg.getStmts().length > 0;
    });
}

function isSemanticCaseFile(fileName: string): boolean {
    return /\.(ets|ts)$/.test(fileName) && /_(T|F)\./.test(fileName);
}

export function createIsolatedCaseView(sourceDir: string, caseName: string, outputRoot: string): string {
    const caseDir = path.join(outputRoot, `${caseName}__${buildUniqueSuffix()}`);
    ensureDir(caseDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        const isCaseFile = fileName === `${caseName}.ets` || fileName === `${caseName}.ts`;
        if (!isCaseFile && isSemanticCaseFile(fileName)) {
            continue;
        }
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(caseDir, fileName));
    }

    return caseDir;
}

export function createIsolatedRunDir(outputRoot: string, name: string): string {
    const dir = path.join(outputRoot, `${name}__${buildUniqueSuffix()}`);
    ensureDir(dir);
    return dir;
}
