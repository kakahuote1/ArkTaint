import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { ArkClass } from "../../../arkanalyzer/out/src/core/model/ArkClass";
import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { collectQualifiedDecoratorCandidates } from "../entry/arkmain/facts/ArkMainStructuralDiscovery";
import { buildTraceGraph, FullTraceRun, TraceGate, TraceGraph } from "./TraceGraph";

export type SourceCoverageCandidateKind = "decorated_field" | "formal_parameter";

export interface SourceCoverageCandidate {
    kind: SourceCoverageCandidateKind;
    subject: string;
    ownerClass?: string;
    targetName: string;
    methodNames: string[];
    methodSignatures: string[];
    decoratorKinds?: string[];
    paramIndex?: number;
    paramName?: string;
    endpoint?: string;
    reason: string;
}

export interface SourceCandidateCoverageTraceGraphInput {
    run: FullTraceRun;
    sourceDir?: string;
    candidates: readonly SourceCoverageCandidate[];
}

export function collectSourceCoverageCandidates(scene: Scene): SourceCoverageCandidate[] {
    const out: SourceCoverageCandidate[] = [];
    out.push(...collectDecoratedFieldSourceCandidates(scene));
    out.push(...collectFormalParameterSourceCandidates(scene));
    return dedupeCandidates(out);
}

export function buildSourceCandidateCoverageTraceGraph(
    input: SourceCandidateCoverageTraceGraphInput,
): TraceGraph {
    const gates: TraceGate[] = [];
    const pushGate = (gate: Omit<TraceGate, "id">): void => {
        gates.push({
            id: `gate:${gates.length + 1}`,
            ...gate,
        });
    };

    pushGate({
        stage: "preanalysis",
        producer: "preanalysis",
        gateKind: "observed_surface",
        scope: `preanalysis:source_candidates:${input.sourceDir || "."}`,
        attempted: true,
        matched: input.candidates.length > 0,
        emitted: input.candidates.length > 0,
        skippedReason: input.candidates.length > 0 ? undefined : "no_source_coverage_candidates",
        evidence: {
            sourceDir: input.sourceDir,
            candidateCount: input.candidates.length,
            traceRole: "source-candidate-coverage-summary",
        },
    });

    for (const candidate of input.candidates) {
        const evidence = candidateEvidence(candidate, input.sourceDir);
        pushGate({
            label: candidate.subject,
            stage: "preanalysis",
            producer: "preanalysis",
            gateKind: "observed_surface",
            scope: `preanalysis:source_candidate:${candidate.subject}`,
            attempted: true,
            matched: true,
            emitted: true,
            evidence,
        });
        pushGate({
            label: candidate.subject,
            stage: "coverage_ledger",
            producer: "coverage_ledger",
            gateKind: "coverage_query",
            scope: `coverage_ledger:source_candidate:${candidate.subject}`,
            attempted: true,
            matched: false,
            emitted: false,
            evidence: {
                ...evidence,
                role: "source",
                endpoint: candidate.endpoint || "unknown",
                coverageStatus: "not-covered",
                reason: "current_assets_do_not_seed_source_candidate",
                traceRole: "source-candidate-gap",
            },
        });
        pushGate({
            label: candidate.subject,
            stage: "source_seed",
            producer: "rule",
            gateKind: "seed",
            scope: `source_seed:source_candidate:${candidate.subject}`,
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "source_candidate_not_seeded_by_current_assets",
            evidence,
        });
    }

    return buildTraceGraph(input.run, [], [], gates);
}

function collectDecoratedFieldSourceCandidates(scene: Scene): SourceCoverageCandidate[] {
    const out: SourceCoverageCandidate[] = [];
    const candidates = collectQualifiedDecoratorCandidates(scene.getClasses())
        .filter(candidate => candidate.targetKind === "field")
        .filter(candidate => hasExternalInputDecorator(candidate.decoratorKinds));
    for (const candidate of candidates) {
        const ownerClass = candidate.ownerClass;
        const methodSignatures = collectOwnerMethodsMentioning(ownerClass, candidate.targetName)
            .map(method => method.getSignature?.()?.toString?.() || "")
            .filter(Boolean);
        out.push({
            kind: "decorated_field",
            subject: stableSourceCandidateSubject([
                "decorated_field",
                ownerClass.getName?.() || "",
                candidate.targetName,
                candidate.decoratorKinds.join("."),
            ]),
            ownerClass: ownerClass.getName?.() || "",
            targetName: candidate.targetName,
            methodNames: methodSignatures.map(formatMethodDisplayName),
            methodSignatures,
            decoratorKinds: [...candidate.decoratorKinds],
            endpoint: `field.${candidate.targetName}`,
            reason: "component decorator field is an external input candidate but no current source seed covers it",
        });
    }
    return out;
}

function collectFormalParameterSourceCandidates(scene: Scene): SourceCoverageCandidate[] {
    const out: SourceCoverageCandidate[] = [];
    for (const method of scene.getMethods()) {
        if (method.isGenerated?.()) continue;
        const methodSignature = method.getSignature?.()?.toString?.() || "";
        if (!methodSignature) continue;
        const params = method.getParameters?.() || [];
        params.forEach((param: any, index: number) => {
            const paramName = String(param?.getName?.() || "").trim();
            if (!isPayloadLikeName(paramName)) return;
            out.push({
                kind: "formal_parameter",
                subject: stableSourceCandidateSubject([
                    "formal_parameter",
                    methodSignature,
                    String(index),
                    paramName,
                ]),
                ownerClass: method.getDeclaringArkClass?.()?.getName?.() || "",
                targetName: paramName,
                methodNames: [formatMethodDisplayName(methodSignature)],
                methodSignatures: [methodSignature],
                paramIndex: index,
                paramName,
                endpoint: `arg${index}`,
                reason: "payload-like formal parameter is a source candidate but no current source seed covers it",
            });
        });
    }
    return out;
}

function hasExternalInputDecorator(kinds: readonly string[]): boolean {
    return kinds.some(kind => {
        const normalized = kind.toLowerCase();
        return normalized === "param"
            || normalized === "prop"
            || normalized === "link"
            || normalized === "objectlink"
            || normalized === "event"
            || normalized === "once";
    });
}

function collectOwnerMethodsMentioning(ownerClass: ArkClass, token: string): ArkMethod[] {
    const out: ArkMethod[] = [];
    for (const method of ownerClass.getMethods?.() || []) {
        if (method.isStatic?.()) continue;
        if (methodMentionsToken(method, token)) {
            out.push(method);
        }
    }
    if (out.length > 0) return out;
    return (ownerClass.getMethods?.() || [])
        .filter(method => !method.isStatic?.())
        .slice(0, 12);
}

function methodMentionsToken(method: ArkMethod, token: string): boolean {
    const normalized = String(token || "").trim();
    if (!normalized) return false;
    if (method.getName?.().includes(normalized)) return true;
    const cfg = method.getCfg?.();
    if (!cfg) return false;
    for (const stmt of cfg.getStmts?.() || []) {
        if (String(stmt?.toString?.() || "").includes(normalized)) {
            return true;
        }
    }
    return false;
}

function isPayloadLikeName(name: string): boolean {
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized || normalized.length < 3) return false;
    if (/\b(index|count|size|width|height|mode|type|status|flag|option|config|setting)\b/.test(normalized)) {
        return false;
    }
    return /\b(content|text|value|data|payload|message|msg|input|keyword|query|url|uri|path|token|password|secret|credential|header|body)\b/.test(normalized);
}

function candidateEvidence(candidate: SourceCoverageCandidate, sourceDir?: string): Record<string, unknown> {
    return {
        sourceDir,
        sourceCandidateKind: candidate.kind,
        ownerClass: candidate.ownerClass,
        targetName: candidate.targetName,
        methodNames: candidate.methodNames,
        methodSignatures: candidate.methodSignatures,
        decoratorKinds: candidate.decoratorKinds,
        paramIndex: candidate.paramIndex,
        paramName: candidate.paramName,
        endpoint: candidate.endpoint,
        reason: candidate.reason,
    };
}

function formatMethodDisplayName(signature: string): string {
    const text = String(signature || "");
    const classMatch = text.match(/([^./:\s]+)\.[^.(\s]+/);
    const methodMatch = text.match(/\.([^.(\s]+)\s*\(/);
    if (classMatch && methodMatch) {
        return `${classMatch[1]}.${methodMatch[1]}`;
    }
    return text;
}

function dedupeCandidates(candidates: SourceCoverageCandidate[]): SourceCoverageCandidate[] {
    const out = new Map<string, SourceCoverageCandidate>();
    for (const candidate of candidates) {
        if (!candidate.subject || out.has(candidate.subject)) continue;
        out.set(candidate.subject, candidate);
    }
    return [...out.values()].sort((left, right) => left.subject.localeCompare(right.subject));
}

function stableSourceCandidateSubject(parts: readonly string[]): string {
    return parts
        .join("|")
        .replace(/\\/g, "/")
        .replace(/[^A-Za-z0-9_.:/@|-]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 220);
}
