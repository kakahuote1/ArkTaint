import {
    fromOfficialDeclaration,
    fromProjectDeclaration,
    fromThirdPartyDeclaration,
    type ApiAuthority,
    type CanonicalApiDescriptor,
    type CanonicalApiDeclarationEvidence,
} from "../../core/api/identity";

export type TestCanonicalApiDeclaration = CanonicalApiDeclarationEvidence & {
    authority: ApiAuthority;
};

export function canonicalApiIdFromTestDeclaration(input: TestCanonicalApiDeclaration): string {
    return canonicalApiDescriptorFromTestDeclaration(input).canonicalApiId;
}

export function canonicalApiDescriptorFromTestDeclaration(input: TestCanonicalApiDeclaration): CanonicalApiDescriptor {
    const { authority, ...evidence } = input;
    const result = authority === "official"
        ? fromOfficialDeclaration(evidence)
        : authority === "project"
            ? fromProjectDeclaration(evidence)
            : fromThirdPartyDeclaration(evidence);
    if (result.status !== "accepted") {
        throw new Error(`test canonical API declaration rejected: ${result.reason}`);
    }
    return result.descriptor;
}

export function indexedTestParameters(types: string[]): CanonicalApiDeclarationEvidence["signature"]["parameters"] {
    return types.map((type, index) => {
        const text = String(type || "");
        if (text.startsWith("rest:")) {
            return { index, rest: true, type: { text: text.slice("rest:".length) } };
        }
        return { index, type: { text } };
    });
}
