import * as fs from "fs";
import * as path from "path";
import {
    groupMirrorEquivalentDescriptors,
    loadOfficialCanonicalApiDescriptors,
} from "../core/api/identity";

interface AuditGroup {
    semanticKey: string;
    representativeCanonicalApiId: string;
    canonicalApiIds: string[];
    replacementCanonicalApiIds: string[];
    declarationFiles: string[];
    member: string;
    parameterTypes: string[];
    returnType: string;
}

function main(): void {
    const outputPath = path.resolve(process.cwd(), "tmp", "unknown_signature_mirror_descriptor_audit.json");
    const descriptors = loadOfficialCanonicalApiDescriptors();
    const groups = groupMirrorEquivalentDescriptors(descriptors);
    const duplicateGroups = groups.filter(group => group.canonicalApiIds.length > 1);
    const auditGroups: AuditGroup[] = duplicateGroups.map(group => ({
        semanticKey: group.semanticKey,
        representativeCanonicalApiId: group.representativeCanonicalApiId,
        canonicalApiIds: group.canonicalApiIds,
        replacementCanonicalApiIds: group.canonicalApiIds.filter(id => id !== group.representativeCanonicalApiId),
        declarationFiles: group.declarationFiles,
        member: group.memberName,
        parameterTypes: group.parameterTypes,
        returnType: group.returnType,
    }));
    const payload = {
        descriptorCount: descriptors.length,
        semanticGroupCount: groups.length,
        mirrorDuplicateGroupCount: duplicateGroups.length,
        replacementCount: auditGroups.reduce((sum, group) => sum + group.replacementCanonicalApiIds.length, 0),
        groups: auditGroups,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify({
        outputPath,
        descriptorCount: payload.descriptorCount,
        semanticGroupCount: payload.semanticGroupCount,
        mirrorDuplicateGroupCount: payload.mirrorDuplicateGroupCount,
        replacementCount: payload.replacementCount,
    }, null, 2));
}

main();
