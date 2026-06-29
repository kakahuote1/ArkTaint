import type { CanonicalApiRegistry } from "../identity";
import type { RawApiOccurrence, ResolvedApiOccurrence } from "./ApiOccurrence";
import { acceptedOccurrence, failedOccurrence } from "./ApiOccurrence";

type ResolutionKind = NonNullable<ResolvedApiOccurrence["resolutionKind"]>;

interface EvidenceResolution {
    kind: ResolutionKind;
    resolved: ReturnType<CanonicalApiRegistry["resolveArkanalyzerMethodKey"]>;
}

export class ApiOccurrenceResolver {
    constructor(private readonly registry: CanonicalApiRegistry) {}

    resolve(raw: RawApiOccurrence): ResolvedApiOccurrence {
        const resolutions: EvidenceResolution[] = [];
        if (raw.ir.arkanalyzerMethodKey) {
            resolutions.push({
                kind: "arkanalyzer-signature",
                resolved: this.registry.resolveArkanalyzerMethodKey(raw.ir.arkanalyzerMethodKey),
            });
        }

        if (raw.importEvidence) {
            resolutions.push({
                kind: "import-member",
                resolved: this.registry.resolveImportMemberKey(raw.importEvidence),
            });
        }

        if (raw.receiverEvidence) {
            resolutions.push({
                kind: "receiver-member",
                resolved: this.registry.resolveReceiverMemberKey(raw.receiverEvidence),
            });
        }

        if (raw.receiverAmbiguityEvidence) {
            resolutions.push({
                kind: "receiver-member",
                resolved: {
                    status: "ambiguous",
                    reason: "receiver_provenance_ambiguous",
                    candidates: raw.receiverAmbiguityEvidence.candidates
                        .map(item => `${item.moduleSpecifier}:${item.receiverType}`)
                        .filter(Boolean),
                    evidence: [{
                        kind: "receiver_provenance_ambiguous",
                        message: "receiver provenance has multiple exact candidates",
                        data: {
                            localName: raw.receiverAmbiguityEvidence.localName,
                            candidates: raw.receiverAmbiguityEvidence.candidates,
                        },
                    }],
                },
            });
        }

        if (raw.arkuiEvidence) {
            resolutions.push({
                kind: "arkui-chain",
                resolved: this.registry.resolveArkUiChainKey(raw.arkuiEvidence),
            });
        }

        if (raw.arkuiAmbiguityEvidence) {
            resolutions.push({
                kind: "arkui-chain",
                resolved: {
                    status: "ambiguous",
                    reason: "arkui_chain_candidate_ambiguous",
                    candidates: raw.arkuiAmbiguityEvidence.candidates
                        .map(item => `${item.componentName}:${item.attributeOwner}:${item.eventName}:${item.callbackArgCount}`)
                        .filter(Boolean),
                    evidence: [{
                        kind: "arkui_chain_candidate_ambiguous",
                        message: "ArkUI chain site has multiple exact official candidates",
                        data: raw.arkuiAmbiguityEvidence,
                    }],
                },
            });
        }

        if (raw.arkuiComponentEvidence) {
            resolutions.push({
                kind: "arkui-component",
                resolved: this.registry.resolveArkUiComponentKey(raw.arkuiComponentEvidence),
            });
        }

        if (raw.decoratorEvidence) {
            resolutions.push({
                kind: "decorator-entry",
                resolved: this.registry.resolveDecoratorKey(raw.decoratorEvidence),
            });
        }

        if (raw.projectEvidence) {
            resolutions.push({
                kind: "project-declaration",
                resolved: this.registry.resolveProjectDeclarationKey(raw.projectEvidence),
            });
        }

        if (resolutions.length === 0) {
            return failedOccurrence({
                raw,
                status: "unresolved",
                reason: "no_identity_evidence",
            });
        }

        const accepted = resolutions.filter(item => item.resolved.status === "accepted" && item.resolved.canonicalApiId);
        const acceptedIds = [...new Set(accepted.map(item => item.resolved.canonicalApiId!))];
        if (acceptedIds.length === 1) {
            const primary = primaryAcceptedResolution(accepted);
            return acceptedOccurrence({
                raw,
                canonicalApiId: acceptedIds[0],
                resolutionKind: primary.kind,
                reason: primary.resolved.reason,
                evidence: accepted.flatMap(item => item.resolved.evidence),
            });
        }

        if (acceptedIds.length > 1) {
            return failedOccurrence({
                raw,
                status: "ambiguous",
                reason: "identity_evidence_conflict",
                candidates: acceptedIds,
                evidence: accepted.flatMap(item => item.resolved.evidence),
            });
        }

        const ambiguous = resolutions.find(item => item.resolved.status === "ambiguous");
        if (ambiguous) {
            return failedOccurrence({
                raw,
                status: "ambiguous",
                reason: ambiguous.resolved.reason,
                candidates: ambiguous.resolved.candidates,
                evidence: ambiguous.resolved.evidence,
            });
        }

        const rejected = resolutions.find(item => item.resolved.status === "rejected");
        if (rejected) {
            return failedOccurrence({
                raw,
                status: "rejected",
                reason: rejected.resolved.reason,
                candidates: rejected.resolved.candidates,
                evidence: rejected.resolved.evidence,
            });
        }

        const unresolved = primaryUnresolvedResolution(resolutions);
        const unresolvedEvidence = resolutions.flatMap(item => item.resolved.evidence);
        return failedOccurrence({
            raw,
            status: "unresolved",
            reason: unresolved?.resolved.reason || "identity_evidence_unresolved",
            evidence: unresolvedEvidence,
        });
    }
}

function primaryAcceptedResolution(accepted: EvidenceResolution[]): EvidenceResolution {
    const priority: ResolutionKind[] = [
        "arkanalyzer-signature",
        "project-declaration",
        "receiver-member",
        "import-member",
        "arkui-component",
        "arkui-chain",
        "callback-registration",
        "decorator-entry",
    ];
    for (const kind of priority) {
        const found = accepted.find(item => item.kind === kind);
        if (found) return found;
    }
    return accepted[0];
}

function primaryUnresolvedResolution(resolutions: EvidenceResolution[]): EvidenceResolution | undefined {
    const unresolved = resolutions.filter(item => item.resolved.status === "unresolved");
    const priority: ResolutionKind[] = [
        "receiver-member",
        "import-member",
        "arkui-component",
        "arkui-chain",
        "decorator-entry",
        "project-declaration",
        "arkanalyzer-signature",
        "callback-registration",
    ];
    for (const kind of priority) {
        const found = unresolved.find(item => item.kind === kind);
        if (found) return found;
    }
    return unresolved[0];
}
