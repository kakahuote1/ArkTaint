declare const process: any;
declare const require: any;
declare const module: any;
declare const __dirname: string;
declare const __filename: string;
declare type NodeRequire = any;

declare namespace NodeJS {
    interface Timeout {
        unref(): Timeout;
    }
}

declare class Buffer {
    static from(data: string | ArrayBuffer | ArrayLike<number>, encoding?: string): Buffer;
    toString(encoding?: string): string;
}

declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): NodeJS.Timeout;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): NodeJS.Timeout;
declare function clearInterval(timeoutId?: NodeJS.Timeout | number): void;
declare function clearTimeout(timeoutId?: NodeJS.Timeout | number): void;

declare module "fs" {
    namespace fs {
        type Stats = any;
        type Dirent = any;
        const constants: any;
        function existsSync(path: any): boolean;
        function statSync(path: any): Stats;
        function readdirSync(path: any, options?: any): Dirent[];
        function readFileSync(path: any, options?: any): string;
        function writeFileSync(path: any, data: any, options?: any): void;
        function mkdirSync(path: any, options?: any): void;
        function rmSync(path: any, options?: any): void;
        function cpSync(src: any, dst: any, options?: any): void;
        function access(path: any, mode: any, callback: any): void;
        function unlinkSync(path: any): void;
        function renameSync(oldPath: any, newPath: any): void;
        function appendFileSync(path: any, data: any, options?: any): void;
        function createWriteStream(path: any, options?: any): any;
    }
    export = fs;
}

declare module "path" {
    namespace path {
        function resolve(...parts: any[]): string;
        function join(...parts: any[]): string;
        function relative(from: string, to: string): string;
        function dirname(p: string): string;
        function basename(p: string, ext?: string): string;
        function extname(p: string): string;
        function isAbsolute(p: string): boolean;
        const sep: string;
    }
    export = path;
}

declare module "os" {
    const os: any;
    export = os;
}

declare module "crypto" {
    namespace crypto {
        function createHash(algorithm: string): any;
    }
    export = crypto;
}

declare module "assert" {
    const assert: any;
    export = assert;
}

declare module "child_process" {
    export interface ChildProcess {
        kill?(signal?: string | number): boolean;
        stdout?: any;
        stderr?: any;
        stdin?: any;
        pid?: number;
        on?(event: string, listener: (...args: any[]) => void): any;
    }

    export function spawn(command: string, args?: readonly string[], options?: any): ChildProcess;
    export function spawnSync(command: string, args?: readonly string[], options?: any): any;
    export function execFileSync(command: string, args?: readonly string[], options?: any): any;
    const childProcess: any;
    export = childProcess;
}

declare module "module" {
    const moduleApi: any;
    export = moduleApi;
}

declare module "readline" {
    export interface Interface {
        question(query: string, callback: (answer: string) => void): void;
        close(): void;
        on(event: string, listener: (...args: any[]) => void): this;
    }
    export function createInterface(options: any): Interface;
}

declare module "vm" {
    const vm: any;
    export = vm;
}

declare module "log4js" {
    export interface Logger {
        addContext?(key: string, value: any): void;
        info(...args: any[]): void;
        warn(...args: any[]): void;
        error(...args: any[]): void;
        debug(...args: any[]): void;
        trace(...args: any[]): void;
        fatal(...args: any[]): void;
    }

    export function configure(config: any): void;
    export function getLogger(name?: any): Logger;
}

declare module "typescript" {
    namespace ts {
        type SourceFile = any;
        type LeftHandSideExpression = any;
        type Node = any;
        type Identifier = any;
        type ExpressionStatement = any;
        type CallExpression = any;
        type VariableDeclaration = any;
        type PropertyAccessExpression = any;
        type ElementAccessExpression = any;
        type StringLiteral = any;
        type NoSubstitutionTemplateLiteral = any;
        type LiteralTypeNode = any;
        const SyntaxKind: any;
        const ScriptTarget: any;
        const ScriptKind: any;
        function createSourceFile(...args: any[]): any;
        function isIdentifier(node: any): boolean;
        function isPropertyAccessExpression(node: any): boolean;
        function isElementAccessExpression(node: any): boolean;
        function isStringLiteral(node: any): boolean;
        function isNoSubstitutionTemplateLiteral(node: any): boolean;
        function isExpressionStatement(node: any): boolean;
        function isCallExpression(node: any): boolean;
        function isVariableDeclaration(node: any): boolean;
        function isPropertyAssignment(node: any): boolean;
        function isShorthandPropertyAssignment(node: any): boolean;
        function isImportSpecifier(node: any): boolean;
        function isExportSpecifier(node: any): boolean;
        function isLiteralTypeNode(node: any): boolean;
        function forEachChild(node: any, cb: (child: any) => void): void;
    }

    export = ts;
}

declare module "ohos-typescript" {
    namespace ts {
        type SourceFile = any;
        type LeftHandSideExpression = any;
        type Node = any;
        type Identifier = any;
        type ExpressionStatement = any;
        type CallExpression = any;
        type VariableDeclaration = any;
        type PropertyAccessExpression = any;
        type ElementAccessExpression = any;
        type StringLiteral = any;
        type NoSubstitutionTemplateLiteral = any;
        type LiteralTypeNode = any;
        const SyntaxKind: any;
        const ScriptTarget: any;
        const ScriptKind: any;
        function createSourceFile(...args: any[]): any;
        function isIdentifier(node: any): boolean;
        function isPropertyAccessExpression(node: any): boolean;
        function isElementAccessExpression(node: any): boolean;
        function isStringLiteral(node: any): boolean;
        function isNoSubstitutionTemplateLiteral(node: any): boolean;
        function isExpressionStatement(node: any): boolean;
        function isCallExpression(node: any): boolean;
        function isVariableDeclaration(node: any): boolean;
        function isPropertyAssignment(node: any): boolean;
        function isShorthandPropertyAssignment(node: any): boolean;
        function isImportSpecifier(node: any): boolean;
        function isExportSpecifier(node: any): boolean;
        function isLiteralTypeNode(node: any): boolean;
        function forEachChild(node: any, cb: (child: any) => void): void;
    }

    export = ts;
}

declare module "undici" {
    export const Agent: any;
}

declare module "node:undici" {
    export const Agent: any;
}
