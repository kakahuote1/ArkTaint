import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import type { CanonicalApiDescriptor } from "./CanonicalApiDescriptor";

export interface CanonicalParameterShape {
    canonicalApiId: string;
    parameterIndex: number;
    acceptsLiteralKinds: string[];
    objectPropertyNames?: string[];
    callbackLike?: boolean;
    promiseLike?: boolean;
    arrayLike?: boolean;
    metadataSource?: "declaration-ast" | "type-text";
}

interface DeclarationTypeIndex {
    readonly logicalFile: string;
    readonly typesByName: Map<string, TypeShape>;
}

interface TypeShape {
    readonly objectPropertyNames?: string[];
    readonly callbackLike?: boolean;
    readonly promiseLike?: boolean;
    readonly arrayLike?: boolean;
    readonly literalKinds: string[];
    readonly extendsNames?: string[];
}

export class DeclarationShapeIndex {
    private readonly parameterShapes = new Map<string, CanonicalParameterShape>();

    static fromDescriptors(descriptors: readonly CanonicalApiDescriptor[]): DeclarationShapeIndex {
        return new DeclarationShapeIndex(descriptors);
    }

    private constructor(descriptors: readonly CanonicalApiDescriptor[]) {
        const declarationIndexes = new Map<string, DeclarationTypeIndex>();
        for (const descriptor of descriptors) {
            const declarationIndex = declarationIndexesForFile(declarationIndexes, descriptor.logicalDeclarationFile);
            for (const parameter of descriptor.signature.parameters) {
                const shape = shapeForParameterType(
                    descriptor,
                    parameter.index,
                    parameter.type.text,
                    declarationIndex,
                );
                this.parameterShapes.set(parameterShapeKey(descriptor.canonicalApiId, parameter.index), shape);
            }
        }
    }

    getParameterShape(canonicalApiId: string, parameterIndex: number): CanonicalParameterShape | undefined {
        return this.parameterShapes.get(parameterShapeKey(canonicalApiId, parameterIndex));
    }
}

function shapeForParameterType(
    descriptor: CanonicalApiDescriptor,
    parameterIndex: number,
    typeText: string,
    declarationIndex: DeclarationTypeIndex | undefined,
): CanonicalParameterShape {
    const normalizedType = normalizeTypeText(typeText);
    const resolved = resolveTypeShape(normalizedType, descriptor, declarationIndex);
    const literalKinds = new Set<string>([
        ...literalKindsForTypeText(normalizedType),
        ...(resolved?.literalKinds || []),
    ]);
    const shape: CanonicalParameterShape = {
        canonicalApiId: descriptor.canonicalApiId,
        parameterIndex,
        acceptsLiteralKinds: [...literalKinds].sort(),
        callbackLike: resolved?.callbackLike || isCallbackLikeTypeText(normalizedType) || undefined,
        promiseLike: resolved?.promiseLike || isPromiseLikeTypeText(normalizedType) || undefined,
        arrayLike: resolved?.arrayLike || isArrayLikeTypeText(normalizedType) || undefined,
        metadataSource: resolved ? "declaration-ast" : "type-text",
    };
    if (resolved?.objectPropertyNames) {
        shape.objectPropertyNames = resolved.objectPropertyNames;
    } else {
        const inlineKeys = inlineObjectPropertyNames(normalizedType);
        if (inlineKeys.length > 0) shape.objectPropertyNames = inlineKeys;
    }
    return shape;
}

function declarationIndexesForFile(
    cache: Map<string, DeclarationTypeIndex>,
    logicalFile: string,
): DeclarationTypeIndex | undefined {
    const normalized = normalizeLogicalFile(logicalFile);
    if (cache.has(normalized)) return cache.get(normalized);
    const built = buildDeclarationTypeIndex(normalized);
    if (built) cache.set(normalized, built);
    return built;
}

function buildDeclarationTypeIndex(logicalFile: string): DeclarationTypeIndex | undefined {
    const physical = physicalPathForLogicalFile(logicalFile);
    if (!physical || !fs.existsSync(physical)) return undefined;
    const text = fs.readFileSync(physical, "utf8");
    const sourceFile = ts.createSourceFile(physical, text, ts.ScriptTarget.Latest, true);
    const typesByName = new Map<string, TypeShape>();

    function visit(node: ts.Node, namespacePath: string[]): void {
        if (ts.isModuleDeclaration(node)) {
            const name = declarationName(node.name);
            const nextPath = name ? [...namespacePath, name] : namespacePath;
            if (node.body) visit(node.body, nextPath);
            return;
        }
        if (ts.isModuleBlock(node)) {
            for (const statement of node.statements) visit(statement, namespacePath);
            return;
        }
        if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
            const name = declarationName(node.name);
            if (!name) return;
            registerTypeShape(
                typesByName,
                [...namespacePath, name],
                shapeFromMembers(node.members, sourceFile, heritageTypeNames(node, namespacePath, sourceFile)),
            );
            return;
        }
        if (ts.isTypeAliasDeclaration(node)) {
            const name = declarationName(node.name);
            if (!name) return;
            registerTypeShape(typesByName, [...namespacePath, name], shapeFromTypeNode(node.type, sourceFile));
            return;
        }
        ts.forEachChild(node, child => visit(child, namespacePath));
    }

    visit(sourceFile, []);
    return { logicalFile, typesByName: resolveTypeShapeInheritance(typesByName) };
}

function shapeFromMembers(
    members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
    sourceFile: ts.SourceFile,
    extendsNames: readonly string[] = [],
): TypeShape {
    const properties = new Set<string>();
    let callbackLike = false;
    for (const member of members) {
        if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && member.name) {
            const name = propertyNameText(member.name);
            if (name) properties.add(name);
        }
        if (ts.isCallSignatureDeclaration(member) || ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
            callbackLike = callbackLike || memberNameText(member) === "call";
        }
    }
    return {
        objectPropertyNames: properties.size > 0 ? [...properties].sort() : undefined,
        callbackLike,
        literalKinds: [],
        promiseLike: false,
        arrayLike: false,
        extendsNames: extendsNames.length > 0 ? [...extendsNames] : undefined,
    };
}

function shapeFromTypeNode(node: ts.TypeNode, sourceFile: ts.SourceFile): TypeShape {
    if (ts.isTypeLiteralNode(node)) {
        return shapeFromMembers(node.members, sourceFile);
    }
    const text = normalizeTypeText(node.getText(sourceFile));
    return {
        objectPropertyNames: inlineObjectPropertyNames(text),
        callbackLike: isCallbackLikeTypeText(text),
        promiseLike: isPromiseLikeTypeText(text),
        arrayLike: isArrayLikeTypeText(text),
        literalKinds: literalKindsForTypeText(text),
        extendsNames: undefined,
    };
}

function heritageTypeNames(
    node: ts.InterfaceDeclaration | ts.ClassDeclaration,
    namespacePath: readonly string[],
    sourceFile: ts.SourceFile,
): string[] {
    const out = new Set<string>();
    for (const clause of node.heritageClauses || []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const heritageType of clause.types) {
            const name = normalizeTypeText(heritageType.expression.getText(sourceFile)).replace(/<[^<>]*>/g, "");
            if (!name) continue;
            out.add(name);
            if (namespacePath.length > 0 && !name.includes(".")) {
                out.add([...namespacePath, name].join("."));
            }
        }
    }
    return [...out].filter(Boolean);
}

function resolveTypeShapeInheritance(typesByName: Map<string, TypeShape>): Map<string, TypeShape> {
    const resolved = new Map<string, TypeShape>();
    const resolving = new Set<string>();

    function resolve(name: string): TypeShape | undefined {
        if (resolved.has(name)) return resolved.get(name);
        const shape = typesByName.get(name);
        if (!shape) return undefined;
        if (resolving.has(name)) return shape;
        resolving.add(name);
        const properties = new Set<string>(shape.objectPropertyNames || []);
        let callbackLike = shape.callbackLike === true;
        let promiseLike = shape.promiseLike === true;
        let arrayLike = shape.arrayLike === true;
        const literalKinds = new Set<string>(shape.literalKinds || []);
        for (const parentName of shape.extendsNames || []) {
            const parent = resolve(parentName);
            if (!parent) continue;
            for (const property of parent.objectPropertyNames || []) properties.add(property);
            callbackLike = callbackLike || parent.callbackLike === true;
            promiseLike = promiseLike || parent.promiseLike === true;
            arrayLike = arrayLike || parent.arrayLike === true;
            for (const kind of parent.literalKinds || []) literalKinds.add(kind);
        }
        resolving.delete(name);
        const merged: TypeShape = {
            objectPropertyNames: properties.size > 0 ? [...properties].sort() : undefined,
            callbackLike,
            promiseLike,
            arrayLike,
            literalKinds: [...literalKinds].sort(),
            extendsNames: shape.extendsNames,
        };
        resolved.set(name, merged);
        return merged;
    }

    for (const name of typesByName.keys()) resolve(name);
    return resolved;
}

function resolveTypeShape(
    typeText: string,
    descriptor: CanonicalApiDescriptor,
    declarationIndex: DeclarationTypeIndex | undefined,
): TypeShape | undefined {
    if (!declarationIndex) return undefined;
    const candidates = typeNameCandidates(typeText, descriptor);
    for (const candidate of candidates) {
        const found = declarationIndex.typesByName.get(candidate);
        if (found) return found;
    }
    return undefined;
}

function typeNameCandidates(typeText: string, descriptor: CanonicalApiDescriptor): string[] {
    const out = new Set<string>();
    for (const token of typeReferenceTokens(typeText)) {
        out.add(token);
        const ownerPrefix = descriptor.declarationOwner.path.slice(0, -1).join(".");
        if (ownerPrefix && !token.includes(".")) out.add(`${ownerPrefix}.${token}`);
        const exportPrefix = descriptor.exportPath
            .map(part => part.name)
            .find(name => name && name.includes("."));
        if (exportPrefix && !token.includes(".")) {
            out.add(`${exportPrefix.split(".").slice(0, -1).join(".")}.${token}`);
        }
    }
    return [...out].filter(Boolean);
}

function typeReferenceTokens(typeText: string): string[] {
    const stripped = normalizeTypeText(typeText)
        .replace(/<[^<>]*>/g, " ")
        .replace(/["'][^"']*["']/g, " ");
    const tokens = stripped.match(/[A-Za-z_$][A-Za-z0-9_$.]*/g) || [];
    const builtins = new Set([
        "string",
        "number",
        "boolean",
        "void",
        "undefined",
        "null",
        "object",
        "Object",
        "Record",
        "Array",
        "Promise",
        "Function",
        "any",
        "unknown",
    ]);
    return tokens.filter(token => !builtins.has(token));
}

function registerTypeShape(map: Map<string, TypeShape>, ownerPath: string[], shape: TypeShape): void {
    const fullName = ownerPath.join(".");
    const shortName = ownerPath[ownerPath.length - 1] || "";
    if (fullName) map.set(fullName, shape);
    if (shortName && !map.has(shortName)) map.set(shortName, shape);
}

function physicalPathForLogicalFile(logicalFile: string): string | undefined {
    const normalized = normalizeLogicalFile(logicalFile);
    if (normalized.startsWith("typescript/lib/")) {
        return path.resolve(process.cwd(), "node_modules", "typescript", "lib", path.basename(normalized));
    }
    if (!normalized.startsWith("api/")) return undefined;
    for (const root of sdkRoots()) {
        const candidate = path.resolve(root, normalized);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

function sdkRoots(): string[] {
    const roots = [
        process.env.ARKTAINT_SDK_ROOT,
        process.env.OPENHARMONY_SDK_DECLARATION_ROOT,
        path.resolve(process.cwd(), "..", "interface_sdk-js"),
        path.resolve(process.cwd(), "interface_sdk-js"),
    ];
    return roots
        .filter((root): root is string => typeof root === "string" && root.trim().length > 0)
        .map(root => path.resolve(root));
}

function inlineObjectPropertyNames(typeText: string): string[] {
    const text = normalizeTypeText(typeText);
    if (!text.startsWith("{") || !text.endsWith("}")) return [];
    const body = text.slice(1, -1);
    const keys = new Set<string>();
    for (const match of body.matchAll(/(?:^|[;,])\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/g)) {
        if (match[1]) keys.add(match[1]);
    }
    return [...keys].sort();
}

function literalKindsForTypeText(typeText: string): string[] {
    const text = normalizeTypeText(typeText);
    const kinds = new Set<string>();
    if (/\bstring\b/.test(text) || /["'][^"']*["']/.test(text)) kinds.add("string");
    if (/\bnumber\b/.test(text) || /(?:^|\W)\d+(?:\.\d+)?(?:\W|$)/.test(text)) kinds.add("number");
    if (/\bboolean\b/.test(text) || /\btrue\b|\bfalse\b/.test(text)) kinds.add("boolean");
    if (/\bnull\b/.test(text)) kinds.add("null");
    if (/\bundefined\b/.test(text)) kinds.add("undefined");
    if (isArrayLikeTypeText(text)) kinds.add("array");
    if (isCallbackLikeTypeText(text)) kinds.add("function");
    if (inlineObjectPropertyNames(text).length > 0 || /\b(Object|Record)\b/.test(text)) kinds.add("object");
    return [...kinds].sort();
}

function isCallbackLikeTypeText(value: string): boolean {
    const text = normalizeTypeText(value);
    return /\b(callback|function)\b/i.test(text)
        || /\b[A-Za-z_$][A-Za-z0-9_$]*Callback\b/.test(text)
        || text.includes("=>")
        || /^Function\b/.test(text)
        || /\([^)]*\)\s*=>/.test(text);
}

function isPromiseLikeTypeText(value: string): boolean {
    return /\bPromise\s*</.test(normalizeTypeText(value));
}

function isArrayLikeTypeText(value: string): boolean {
    const text = normalizeTypeText(value);
    return /\bArray\s*</.test(text) || /\[\]\s*$/.test(text);
}

function declarationName(name: ts.Node | undefined): string | undefined {
    if (!name) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return name.getText();
}

function propertyNameText(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return undefined;
}

function memberNameText(member: ts.Node): string | undefined {
    const maybeNamed = member as { name?: ts.PropertyName };
    return maybeNamed.name ? propertyNameText(maybeNamed.name) : undefined;
}

function normalizeTypeText(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLogicalFile(value: string): string {
    return String(value || "").replace(/\\/g, "/").trim();
}

function parameterShapeKey(canonicalApiId: string, parameterIndex: number): string {
    return `${canonicalApiId}#${parameterIndex}`;
}
