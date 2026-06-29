import * as fs from "fs";
import * as path from "path";
import type {
    ApiDomain,
    CanonicalApiDescriptor,
    CanonicalExportPath,
    CanonicalInvokeKind,
    CanonicalMemberKind,
} from "./CanonicalApiDescriptor";
import {
    fromOfficialDeclaration,
    type CanonicalApiDeclarationEvidence,
} from "./CanonicalApiDescriptorBuilder";

interface OfficialApiInventory {
    apis: OfficialApiInventoryApi[];
}

interface OfficialApiInventoryApi {
    id?: string;
    file?: string;
    line?: number;
    kind?: string;
    name?: string;
    context?: string[];
    parameters?: Array<{
        name?: string;
        type?: string;
    }>;
    returnType?: string;
    signature?: string;
}

interface SdkSignature {
    ownerKind: CanonicalApiDeclarationEvidence["declarationOwner"]["kind"];
    ownerPath: string[];
    exportPath?: CanonicalExportPath[];
    memberKey: string;
    invoke: CanonicalInvokeKind;
    params: string;
    ret: string;
    line: number;
}

interface SdkDeclarationIndex {
    logicalFile: string;
    physical: string;
    byFull: Map<string, SdkSignature[]>;
}

const DEFAULT_INVENTORY_PATH = path.join(
    "internal_docs",
    "security_asset_iteration",
    "official_api_semantic_inventory.json",
);

let descriptorCache: CanonicalApiDescriptor[] | undefined;
let descriptorDiagnostics: string[] = [];
const sdkDeclarationIndexes = new Map<string, SdkDeclarationIndex>();
let tsModule: any | undefined;

export function loadOfficialDeclarationInventoryDescriptors(): CanonicalApiDescriptor[] {
    if (!descriptorCache) {
        const inventory = readOfficialApiInventory(resolveRepoPath(DEFAULT_INVENTORY_PATH));
        const descriptors = new Map<string, CanonicalApiDescriptor>();
        const diagnostics: string[] = [];
        for (const api of inventory.apis) {
            try {
                for (const declaration of declarationsForOfficialInventoryApi(api)) {
                    const result = fromOfficialDeclaration(declaration);
                    if (result.status !== "accepted") {
                        diagnostics.push(`${api.id || api.name || "<unknown>"}:${result.reason}`);
                        continue;
                    }
                    const existing = descriptors.get(result.descriptor.canonicalApiId);
                    if (existing && JSON.stringify(existing) !== JSON.stringify(result.descriptor)) {
                        diagnostics.push(`${api.id || api.name || "<unknown>"}:canonical descriptor collision ${result.descriptor.canonicalApiId}`);
                        continue;
                    }
                    descriptors.set(result.descriptor.canonicalApiId, result.descriptor);
                }
            } catch (error) {
                diagnostics.push(`${api.id || api.name || "<unknown>"}:${error instanceof Error ? error.message : String(error)}`);
            }
        }
        descriptorDiagnostics = diagnostics;
        descriptorCache = [...descriptors.values()]
            .sort((left, right) => left.canonicalApiId.localeCompare(right.canonicalApiId));
    }
    return descriptorCache.map(descriptor => cloneDescriptor(descriptor));
}

export function getOfficialDeclarationInventoryDescriptorDiagnostics(): string[] {
    if (!descriptorCache) {
        loadOfficialDeclarationInventoryDescriptors();
    }
    return [...descriptorDiagnostics];
}

export function declarationsForOfficialInventoryApi(api: OfficialApiInventoryApi): CanonicalApiDeclarationEvidence[] {
    const ownerPath = ownerPathForApi(api);
    const ownerName = ownerPath.join(".");
    const declarations: CanonicalApiDeclarationEvidence[] = [];
    for (const invoke of invokeKindsForApi(api)) {
        const member = memberForApi(api);
        const sdkDeclaration = sdkDeclarationForApi(api, member, invoke);
        declarations.push({
            domain: domainForApi(api),
            moduleSpecifier: moduleSpecifierForApi(api.file || ""),
            logicalDeclarationFile: logicalDeclarationFileForApi(api.file || ""),
            exportPath: exportPathForApi(api, ownerName, sdkDeclaration),
            declarationOwner: {
                kind: sdkDeclaration.ownerKind,
                path: ownerPath,
                normalizedName: ownerName,
                arkanalyzerName: ownerName,
            },
            member,
            invoke: { kind: invoke },
            signature: {
                parameters: (api.parameters || []).map((param, index) => ({
                    index,
                    name: cleanParameterName(param?.name),
                    optional: isOptionalParam(api, param),
                    rest: isRestParam(api, param),
                    type: { text: parameterTypeForApiParam(param) },
                })),
                returnType: { text: returnTypeForApi(api) },
            },
            arkanalyzer: api.kind === "property" ? undefined : {
                declaringFileName: logicalDeclarationFileForApi(api.file || ""),
                declaringNamespacePath: [],
                declaringClassName: ownerName,
                methodName: api.kind === "constructor" ? "constructor" : String(api.name || ""),
                parameterTypes: (api.parameters || []).map(parameterTypeForApiParam),
                returnType: returnTypeForApi(api),
                staticFlag: member.static === true,
            },
            declarationLocations: [{ file: logicalDeclarationFileForApi(api.file || ""), line: api.line }],
        });
    }
    return declarations;
}

function readOfficialApiInventory(filePath: string): OfficialApiInventory {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as OfficialApiInventory;
    if (!value || !Array.isArray(value.apis)) {
        throw new Error(`official API inventory must contain apis array: ${filePath}`);
    }
    return value;
}

function invokeKindsForApi(api: OfficialApiInventoryApi): CanonicalInvokeKind[] {
    if (api.kind === "constructor") return ["new"];
    if (api.kind === "property") return ["property-read", "property-write"];
    return ["call"];
}

function memberForApi(api: OfficialApiInventoryApi): CanonicalApiDeclarationEvidence["member"] {
    if (api.kind === "constructor") {
        return { kind: "constructor", name: "constructor" };
    }
    if (api.kind === "property") {
        return { kind: "property", name: String(api.name || "") };
    }
    if (api.kind === "function") {
        return { kind: "function", name: String(api.name || "") };
    }
    if (api.kind === "call-signature") {
        return { kind: "method", name: String(api.name || "call"), static: false };
    }
    return { kind: "method", name: String(api.name || ""), static: isStaticApi(api) };
}

function exportPathForApi(
    api: OfficialApiInventoryApi,
    ownerName: string,
    sdkDeclaration: Pick<SdkSignature, "exportPath">,
): CanonicalExportPath[] {
    if (api.file && api.file.includes("@internal/component/ets/")) {
        return [{
            kind: "component",
            name: String(ownerName || "").replace(/(Interface|Attribute)$/, ""),
        }];
    }
    if (!sdkDeclaration.exportPath) {
        throw new Error(`official SDK export path must be exact for ${api.id || api.name}`);
    }
    return sdkDeclaration.exportPath;
}

function ownerPathForApi(api: OfficialApiInventoryApi): string[] {
    const context = (api.context || []).map(value => String(value || "").trim()).filter(Boolean);
    if (context.length > 0) return context;
    if (api.kind === "function") return [String(api.name || "file")];
    return [String(api.name || "OfficialApi")];
}

function domainForApi(api: OfficialApiInventoryApi): ApiDomain {
    const file = String(api.file || "").replace(/\\/g, "/");
    if (file.includes("@internal/component/ets/") || file.startsWith("api/arkui/")) return "arkui";
    if (file.startsWith("arkts/")) return "arkts";
    if (file.includes("tsjs")) return "tsjs";
    return "openharmony";
}

function moduleSpecifierForApi(file: string): string {
    const normalized = logicalDeclarationFileForApi(file);
    const apiModule = /^api\/(@.+)\.d\.(ts|ets)$/.exec(normalized);
    if (apiModule) return apiModule[1];
    const arktsModule = /^arkts\/(.+)\.d\.ets$/.exec(normalized);
    if (arktsModule) return arktsModule[1];
    return normalized;
}

function logicalDeclarationFileForApi(file: string): string {
    return String(file || "").replace(/\\/g, "/").trim();
}

function returnTypeForApi(api: OfficialApiInventoryApi): string {
    const explicit = normalizeText(api.returnType);
    if (explicit) return explicit;
    if (api.kind === "constructor") return ownerPathForApi(api).slice(-1)[0] || "constructor";
    return "void";
}

function parameterTypeForApiParam(param: { type?: string } | undefined): string {
    return normalizeText(param?.type);
}

function cleanParameterName(name: string | undefined): string | undefined {
    return String(name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim() || undefined;
}

function isStaticApi(api: OfficialApiInventoryApi): boolean {
    return /\bstatic\b/.test(String(api.signature || "").trim());
}

function isRestParam(api: OfficialApiInventoryApi, param: { name?: string } | undefined): boolean {
    const name = String(param?.name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim();
    if (String(param?.name || "").startsWith("...")) return true;
    return !!name && new RegExp(`\\.\\.\\.\\s*${escapeRegExp(name)}\\b`).test(String(api.signature || ""));
}

function isOptionalParam(api: OfficialApiInventoryApi, param: { name?: string } | undefined): boolean {
    const name = String(param?.name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim();
    if (String(param?.name || "").endsWith("?")) return true;
    return !!name && new RegExp(`\\b${escapeRegExp(name)}\\?\\s*:`).test(String(api.signature || ""));
}

function sdkDeclarationForApi(
    api: OfficialApiInventoryApi,
    member: { kind: CanonicalMemberKind; name: string; static?: boolean },
    invoke: CanonicalInvokeKind,
): Pick<SdkSignature, "ownerKind" | "exportPath"> {
    const logicalFile = logicalDeclarationFileForApi(api.file || "");
    const index = sdkDeclarationIndexFor(logicalFile);
    const ownerPath = ownerPathForApi(api);
    const memberKey = member.kind === "constructor"
        ? "constructor:new:constructor"
        : member.static === undefined
            ? `${member.kind}:${member.name}`
            : `${member.kind}:${member.static ? "static" : "instance"}:${member.name}`;
    const full = `${ownerPath.join(".")}|${memberKey}|${invoke}|${canonicalParamStringForApi(api)}|${returnTypeForApi(api)}`;
    const candidates = index.byFull.get(full) || [];
    const uniqueDeclarations = new Map(candidates.map(candidate => [
        `${candidate.ownerKind}|${serializeExportPath(candidate.exportPath)}`,
        {
            ownerKind: candidate.ownerKind,
            exportPath: candidate.exportPath,
        },
    ]));
    if (uniqueDeclarations.size !== 1) {
        throw new Error(`official SDK owner kind must be exact for ${api.id || api.name}: key=${full} candidates=${JSON.stringify(candidates.slice(0, 8))}`);
    }
    return [...uniqueDeclarations.values()][0];
}

function sdkDeclarationIndexFor(logicalFile: string): SdkDeclarationIndex {
    const normalized = logicalDeclarationFileForApi(logicalFile);
    const existing = sdkDeclarationIndexes.get(normalized);
    if (existing) return existing;
    const index = buildSdkDeclarationIndex(normalized);
    sdkDeclarationIndexes.set(normalized, index);
    return index;
}

function buildSdkDeclarationIndex(logicalFile: string): SdkDeclarationIndex {
    const physical = physicalSdkPath(logicalFile);
    if (!fs.existsSync(physical)) {
        throw new Error(`official SDK declaration file not found: ${physical}`);
    }
    const ts = getTypescript();
    const text = fs.readFileSync(physical, "utf8");
    const sf = ts.createSourceFile(physical, text, ts.ScriptTarget.Latest, true);
    const exports = collectSdkExports(sf, ts);
    const index: SdkDeclarationIndex = {
        logicalFile,
        physical,
        byFull: new Map(),
    };

    function visit(node: any, namespacePath: string[]): void {
        if (ts.isModuleDeclaration(node)) {
            const name = declarationName(node, ts);
            const nextPath = name ? [...namespacePath, name] : namespacePath;
            if (node.body) visit(node.body, nextPath);
            return;
        }
        if (ts.isModuleBlock(node)) {
            for (const statement of node.statements) visit(statement, namespacePath);
            return;
        }
        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
            const name = declarationName(node, ts);
            if (!name) return;
            const ownerKind = ts.isClassDeclaration(node) ? "class" : "interface";
            const ownerPath = [...namespacePath, name];
            const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports, ts);
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
                    const nameText = memberName(member, ts);
                    if (!nameText) continue;
                    const isStatic = ts.isMethodDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword);
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, `method:${isStatic ? "static" : "instance"}:${nameText}`, "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
                } else if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, "constructor:new:constructor", "new", serializeSdkParameters(member.parameters, sf), name, member);
                } else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
                    const nameText = memberName(member, ts);
                    if (!nameText) continue;
                    const typeText = sdkReturnType(member, sf, "any");
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-read", "none", typeText, member);
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-write", "none", typeText, member);
                } else if (ts.isGetAccessor(member)) {
                    const nameText = memberName(member, ts);
                    if (!nameText) continue;
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, `getter:${nameText}`, "property-read", "none", sdkReturnType(member, sf, "any"), member);
                } else if (ts.isSetAccessor(member)) {
                    const nameText = memberName(member, ts);
                    if (!nameText) continue;
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, `setter:${nameText}`, "property-write", serializeSdkParameters(member.parameters, sf), "void", member);
                } else if (ts.isCallSignatureDeclaration(member)) {
                    addSdkSignature(index, ownerKind, ownerPath, exportPath, "method:instance:call", "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
                }
            }
            return;
        }
        if (ts.isFunctionDeclaration(node)) {
            const name = declarationName(node, ts);
            if (!name) return;
            const ownerKind = namespacePath.length ? "namespace" : "function";
            const ownerPath = namespacePath.length ? namespacePath : [name];
            const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports, ts);
            addSdkSignature(index, ownerKind, ownerPath, exportPath, `function:${name}`, "call", serializeSdkParameters(node.parameters, sf), sdkReturnType(node, sf), node);
            return;
        }
        if (ts.isTypeAliasDeclaration(node)) {
            const name = declarationName(node, ts);
            if (name && ts.isTypeLiteralNode(node.type)) {
                const ownerKind = "type";
                const ownerPath = [...namespacePath, name];
                const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports, ts);
                for (const member of node.type.members) {
                    if (ts.isPropertySignature(member)) {
                        const nameText = memberName(member, ts);
                        if (!nameText) continue;
                        const typeText = sdkReturnType(member, sf, "any");
                        addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-read", "none", typeText, member);
                        addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-write", "none", typeText, member);
                    } else if (ts.isMethodSignature(member)) {
                        const nameText = memberName(member, ts);
                        if (!nameText) continue;
                        addSdkSignature(index, ownerKind, ownerPath, exportPath, `method:instance:${nameText}`, "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
                    } else if (ts.isCallSignatureDeclaration(member)) {
                        addSdkSignature(index, ownerKind, ownerPath, exportPath, "method:instance:call", "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
                    }
                }
            }
            return;
        }
        if (ts.isVariableStatement(node) && namespacePath.length) {
            for (const declaration of node.declarationList.declarations) {
                const name = declarationName(declaration, ts);
                if (!name) continue;
                const typeText = declaration.type ? normalizeText(declaration.type.getText(sf)) : "any";
                const exportPath = sdkExportPathForOwner("namespace", namespacePath, declaration, namespacePath, exports, ts);
                addSdkSignature(index, "namespace", namespacePath, exportPath, `property:${name}`, "property-read", "none", typeText, declaration);
                addSdkSignature(index, "namespace", namespacePath, exportPath, `property:${name}`, "property-write", "none", typeText, declaration);
            }
            return;
        }
        ts.forEachChild(node, (child: any) => visit(child, namespacePath));
    }

    visit(sf, []);
    return index;
}

function collectSdkExports(sf: any, ts: any): {
    defaultExportNames: Set<string>;
    namedExportNames: Set<string>;
    namespaceReexports: Map<string, string>;
} {
    const defaultExportNames = new Set<string>();
    const namedExportNames = new Set<string>();
    const namespaceReexports = new Map<string, string>();

    function visit(node: any, namespacePath: string[]): void {
        if (ts.isModuleDeclaration(node)) {
            const name = declarationName(node, ts);
            const nextPath = name ? [...namespacePath, name] : namespacePath;
            if (node.body) visit(node.body, nextPath);
            return;
        }
        if (ts.isModuleBlock(node)) {
            for (const statement of node.statements) visit(statement, namespacePath);
            return;
        }
        if (ts.isExportAssignment(node)) {
            if (namespacePath.length > 0) return;
            const expression = node.expression;
            if (expression) {
                defaultExportNames.add(normalizeText(expression.getText(sf)));
            }
            return;
        }
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const element of node.exportClause.elements) {
                const localName = element.propertyName ? element.propertyName.text : element.name.text;
                const exportedName = element.name.text;
                if (namespacePath.length > 0) {
                    const namespaceName = namespacePath.join(".");
                    namespaceReexports.set(localName, namespaceName);
                    namespaceReexports.set(exportedName, namespaceName);
                } else {
                    namedExportNames.add(localName);
                    namedExportNames.add(exportedName);
                }
            }
            return;
        }
        ts.forEachChild(node, (child: any) => visit(child, namespacePath));
    }

    visit(sf, []);
    return { defaultExportNames, namedExportNames, namespaceReexports };
}

function sdkExportPathForOwner(
    ownerKind: string,
    ownerPath: string[],
    node: any,
    namespacePath: string[],
    exports: ReturnType<typeof collectSdkExports>,
    ts: any,
): CanonicalExportPath[] | undefined {
    const ownerName = ownerPath.join(".");
    if (namespacePath.length > 0) {
        const namespaceName = namespacePath.join(".");
        if (ownerKind === "namespace" && ownerName === namespaceName && exports.defaultExportNames.has(namespaceName)) {
            return [{ kind: "default", name: namespaceName }];
        }
        return [{ kind: "namespace", name: ownerName }];
    }

    const topLevelName = ownerPath[0] || ownerName;
    if (hasModifier(node, ts.SyntaxKind.DefaultKeyword) || exports.defaultExportNames.has(topLevelName)) {
        return [{ kind: "default", name: topLevelName }];
    }
    const reexportingNamespace = exports.namespaceReexports.get(topLevelName);
    if (reexportingNamespace && exports.defaultExportNames.has(reexportingNamespace)) {
        return [{ kind: "default", name: reexportingNamespace }];
    }
    if (reexportingNamespace) {
        return [{ kind: "namespace", name: `${reexportingNamespace}.${topLevelName}` }];
    }
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || exports.namedExportNames.has(topLevelName)) {
        return [{ kind: "named", name: topLevelName }];
    }
    return undefined;
}

function addSdkSignature(
    index: SdkDeclarationIndex,
    ownerKind: SdkSignature["ownerKind"],
    ownerPath: string[],
    exportPath: CanonicalExportPath[] | undefined,
    memberKey: string,
    invoke: CanonicalInvokeKind,
    params: string,
    ret: string,
    node: any,
): void {
    const full = `${ownerPath.join(".")}|${memberKey}|${invoke}|${params}|${ret}`;
    const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const item: SdkSignature = {
        ownerKind,
        ownerPath,
        exportPath,
        memberKey,
        invoke,
        params,
        ret,
        line,
    };
    const current = index.byFull.get(full) || [];
    current.push(item);
    index.byFull.set(full, current);
}

function physicalSdkPath(logicalFile: string): string {
    const root = process.env.ARKTAINT_INTERFACE_SDK_JS || path.resolve(process.cwd(), "..", "interface_sdk-js");
    return path.resolve(root, logicalDeclarationFileForApi(logicalFile));
}

function canonicalParamStringForApi(api: OfficialApiInventoryApi): string {
    const params = api.parameters || [];
    if (params.length === 0) return "none";
    return params.map((param, index) => {
        const optional = isOptionalParam(api, param);
        const rest = isRestParam(api, param);
        const flags = [optional ? "?" : "", rest ? "rest" : ""].filter(Boolean).join("");
        const prefix = flags ? `${flags}:` : "";
        return `${index}:${prefix}${parameterTypeForApiParam(param)}`;
    }).join(",");
}

function serializeSdkParameters(parameters: any, sf: any): string {
    if (!parameters || parameters.length === 0) return "none";
    return parameters.map((parameter: any, index: number) => {
        const optional = !!parameter.questionToken || !!parameter.initializer;
        const rest = !!parameter.dotDotDotToken;
        const flags = [optional ? "?" : "", rest ? "rest" : ""].filter(Boolean).join("");
        const prefix = flags ? `${flags}:` : "";
        const typeText = parameter.type ? normalizeText(parameter.type.getText(sf)) : "any";
        return `${index}:${prefix}${typeText}`;
    }).join(",");
}

function sdkReturnType(node: any, sf: any, defaultType = "void"): string {
    return node.type ? normalizeText(node.type.getText(sf)) : defaultType;
}

function serializeExportPath(exportPath: CanonicalExportPath[] | undefined): string {
    if (!exportPath) return "<unexported>";
    return exportPath.map(part => `${part.kind}:${part.name}`).join(".");
}

function declarationName(node: any, ts: any): string | undefined {
    if (!node || !node.name) return undefined;
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
        return node.name.text;
    }
    return node.name.getText();
}

function memberName(node: any, ts: any): string | undefined {
    if (!node.name) return undefined;
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
        return node.name.text;
    }
    return node.name.getText();
}

function hasModifier(node: any, kind: number): boolean {
    return !!node.modifiers && node.modifiers.some((modifier: any) => modifier.kind === kind);
}

function getTypescript(): any {
    if (!tsModule) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        tsModule = require("typescript");
    }
    return tsModule;
}

function resolveRepoPath(relativePath: string): string {
    return path.resolve(process.cwd(), relativePath);
}

function escapeRegExp(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: unknown): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function cloneDescriptor(descriptor: CanonicalApiDescriptor): CanonicalApiDescriptor {
    return JSON.parse(JSON.stringify(descriptor)) as CanonicalApiDescriptor;
}
