export type ApiAuthority = "official" | "project" | "third_party";

export type ApiDomain =
    | "openharmony"
    | "arkui"
    | "arkts"
    | "tsjs"
    | "npm"
    | "local";

export type CanonicalDeclarationOwnerKind =
    | "namespace"
    | "class"
    | "interface"
    | "type"
    | "function"
    | "file"
    | "entry";

export type CanonicalMemberKind =
    | "function"
    | "method"
    | "constructor"
    | "getter"
    | "setter"
    | "property"
    | "decorator"
    | "lifecycle"
    | "component-event";

export type CanonicalInvokeKind =
    | "call"
    | "new"
    | "property-read"
    | "property-write"
    | "decorator"
    | "entry"
    | "component-chain";

export interface CanonicalExportPath {
    kind: "default" | "namespace" | "named" | "component" | "entry" | "reexport";
    name: string;
}

export interface CanonicalType {
    text: string;
    kind?: "primitive" | "object" | "array" | "union" | "function" | "generic" | "unknown";
}

export interface CanonicalParameter {
    index: number;
    name?: string;
    type: CanonicalType;
    optional?: boolean;
    rest?: boolean;
}

export interface ArkanalyzerMethodKey {
    declaringFileName: string;
    declaringNamespacePath: string[];
    declaringClassName: string;
    methodName: string;
    parameterTypes: string[];
    returnType: string;
    staticFlag: boolean;
}

export interface CanonicalApiDescriptor {
    canonicalApiId: string;

    authority: ApiAuthority;
    domain: ApiDomain;

    moduleSpecifier: string;
    logicalDeclarationFile: string;
    exportPath: CanonicalExportPath[];

    declarationOwner: {
        kind: CanonicalDeclarationOwnerKind;
        path: string[];
        normalizedName: string;
        arkanalyzerName?: string;
    };

    member: {
        kind: CanonicalMemberKind;
        name: string;
        static?: boolean;
    };

    invoke: {
        kind: CanonicalInvokeKind;
    };

    signature: {
        parameters: CanonicalParameter[];
        returnType: CanonicalType;
    };

    arkanalyzer?: ArkanalyzerMethodKey;

    provenance: {
        source: "official-declaration" | "project-declaration" | "third-party-declaration" | "reviewed-project-asset";
        declarationLocations: Array<{ file: string; line?: number; column?: number }>;
    };
}

export interface IdentityEvidence {
    kind: string;
    message: string;
    data?: Record<string, unknown>;
}

