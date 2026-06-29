import type { RawApiOccurrence, ResolvedApiOccurrence } from "./ApiOccurrence";

export type OfficialOccurrenceEvidenceNodeKind =
    | "raw-signature"
    | "arkanalyzer-method-key"
    | "receiver"
    | "result-use"
    | "import-binding"
    | "member-chain"
    | "alias"
    | "shape-arity"
    | "shape-parameter-type"
    | "shape-literal-kind"
    | "shape-object-keys"
    | "shape-callback-position"
    | "shape-spread-position"
    | "arkui-chain"
    | "arkui-component"
    | "decorator"
    | "project-declaration"
    | "official-hint"
    | "resolution";

export type OfficialOccurrenceEvidenceEdgeKind =
    | "supports"
    | "imports"
    | "selects-member"
    | "uses-receiver"
    | "writes-result"
    | "has-shape"
    | "has-alias"
    | "resolved-as";

export interface OfficialOccurrenceEvidenceNode {
    readonly id: string;
    readonly kind: OfficialOccurrenceEvidenceNodeKind;
    readonly label: string;
    readonly status: "known" | "unknown" | "rejected";
    readonly data?: Record<string, unknown>;
}

export interface OfficialOccurrenceEvidenceEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: OfficialOccurrenceEvidenceEdgeKind;
}

export interface OfficialOccurrenceEvidenceGraph {
    readonly occurrenceId: string;
    readonly rawOccurrenceId: string;
    readonly status: ResolvedApiOccurrence["status"];
    readonly reasonCode: string;
    readonly canonicalApiId?: string;
    readonly nodes: OfficialOccurrenceEvidenceNode[];
    readonly edges: OfficialOccurrenceEvidenceEdge[];
    readonly missingEvidence: string[];
}

export function buildOfficialOccurrenceEvidenceGraph(
    raw: RawApiOccurrence,
    resolved: ResolvedApiOccurrence,
): OfficialOccurrenceEvidenceGraph {
    const nodes: OfficialOccurrenceEvidenceNode[] = [];
    const edges: OfficialOccurrenceEvidenceEdge[] = [];
    const missingEvidence = new Set<string>();
    const rootId = "occurrence";
    addNode(nodes, {
        id: rootId,
        kind: "resolution",
        label: resolved.status,
        status: resolved.status === "rejected" ? "rejected" : "known",
        data: {
            reasonCode: resolved.reason,
            canonicalApiId: resolved.canonicalApiId,
            candidates: resolved.candidates || [],
            resolutionKind: resolved.resolutionKind,
            evidence: resolved.evidence.map(item => ({
                kind: item.kind,
                message: item.message,
                data: item.data,
            })),
        },
    });

    if (raw.ir.methodSignatureText) {
        const id = "raw-signature";
        addNode(nodes, {
            id,
            kind: "raw-signature",
            label: raw.ir.methodSignatureText,
            status: raw.ir.unknownSignature ? "unknown" : "known",
            data: { unknownSignature: raw.ir.unknownSignature },
        });
        addEdge(edges, id, rootId, "supports");
    } else {
        missingEvidence.add("raw_method_signature");
    }

    if (raw.ir.arkanalyzerMethodKey) {
        const id = "arkanalyzer-method-key";
        addNode(nodes, {
            id,
            kind: "arkanalyzer-method-key",
            label: raw.ir.arkanalyzerMethodKey.methodName || "method",
            status: raw.ir.unknownSignature ? "unknown" : "known",
            data: {
                ...raw.ir.arkanalyzerMethodKey,
            },
        });
        addEdge(edges, id, rootId, "supports");
    } else {
        missingEvidence.add("arkanalyzer_method_key");
    }

    if (raw.ir.receiverText) {
        const id = "receiver";
        addNode(nodes, {
            id,
            kind: "receiver",
            label: raw.ir.receiverText,
            status: isUnknownEvidenceText(raw.ir.receiverText) ? "unknown" : "known",
        });
        addEdge(edges, id, rootId, "uses-receiver");
    } else if (raw.kind === "invoke" || raw.kind === "property-access") {
        missingEvidence.add("receiver_text");
    }

    if (raw.ir.resultText) {
        const id = "result-use";
        addNode(nodes, {
            id,
            kind: "result-use",
            label: raw.ir.resultText,
            status: isUnknownEvidenceText(raw.ir.resultText) ? "unknown" : "known",
            data: {
                resultUseKind: raw.ir.resultUseKind || "assignment",
                awaited: raw.ir.resultUseKind === "await-assignment",
                promiseChain: raw.ir.resultUseKind === "promise-chain",
            },
        });
        addEdge(edges, id, rootId, "writes-result");
    }

    if (raw.importEvidence) {
        const importId = "import-binding";
        addNode(nodes, {
            id: importId,
            kind: "import-binding",
            label: `${raw.importEvidence.importKind}:${raw.importEvidence.localName}`,
            status: raw.importEvidence.scopeEvidence.shadowed ? "rejected" : "known",
            data: {
                moduleSpecifier: raw.importEvidence.moduleSpecifier,
                importKind: raw.importEvidence.importKind,
                importedName: raw.importEvidence.importedName,
                localBindingId: raw.importEvidence.localBindingId,
                localName: raw.importEvidence.localName,
                shadowed: raw.importEvidence.scopeEvidence.shadowed,
                sourceFile: raw.importEvidence.scopeEvidence.sourceFile,
                enclosingMethodSignature: raw.importEvidence.scopeEvidence.enclosingMethodSignature,
            },
        });
        addEdge(edges, importId, rootId, "imports");
        addMemberChainNodes(nodes, edges, importId, raw.importEvidence.memberChain);
        addAliasNodes(nodes, edges, importId, raw.importEvidence.aliasChain);
        addShapeNodes(nodes, edges, rootId, raw);
    }

    if (raw.receiverEvidence) {
        const id = "receiver-member";
        addNode(nodes, {
            id,
            kind: "receiver",
            label: `${raw.receiverEvidence.receiverType}.${raw.receiverEvidence.memberName}`,
            status: isUnknownEvidenceText(raw.receiverEvidence.receiverType) ? "unknown" : "known",
            data: {
                moduleSpecifier: raw.receiverEvidence.moduleSpecifier,
                receiverType: raw.receiverEvidence.receiverType,
                memberName: raw.receiverEvidence.memberName,
                invokeKind: raw.receiverEvidence.invokeKind,
                arity: raw.receiverEvidence.argShape.arity,
                provenance: { ...raw.receiverEvidence.provenance },
            },
        });
        addEdge(edges, id, rootId, "uses-receiver");
        addReceiverShapeNodes(nodes, edges, rootId, raw);
    }

    if (raw.receiverAmbiguityEvidence) {
        const id = "receiver-ambiguity";
        addNode(nodes, {
            id,
            kind: "receiver",
            label: raw.receiverAmbiguityEvidence.localName,
            status: "unknown",
            data: {
                localName: raw.receiverAmbiguityEvidence.localName,
                candidates: raw.receiverAmbiguityEvidence.candidates.map(item => ({ ...item })),
            },
        });
        addEdge(edges, id, rootId, "uses-receiver");
    }

    if (raw.arkuiEvidence) {
        const id = "arkui-chain";
        addNode(nodes, {
            id,
            kind: "arkui-chain",
            label: `${raw.arkuiEvidence.componentName}.${raw.arkuiEvidence.eventName}`,
            status: "known",
            data: { ...raw.arkuiEvidence },
        });
        addEdge(edges, id, rootId, "supports");
    }

    if (raw.arkuiComponentEvidence) {
        const id = "arkui-component";
        addNode(nodes, {
            id,
            kind: "arkui-component",
            label: `${raw.arkuiComponentEvidence.componentName}.${raw.arkuiComponentEvidence.memberName}`,
            status: "known",
            data: {
                ...raw.arkuiComponentEvidence,
                argShape: {
                    ...raw.arkuiComponentEvidence.argShape,
                    parameterTypes: [...(raw.arkuiComponentEvidence.argShape.parameterTypes || [])],
                    literalKinds: [...(raw.arkuiComponentEvidence.argShape.literalKinds || [])],
                    objectKeys: (raw.arkuiComponentEvidence.argShape.objectKeys || []).map(item => ({
                        index: item.index,
                        keys: [...item.keys],
                    })),
                    callbackPositions: [...(raw.arkuiComponentEvidence.argShape.callbackPositions || [])],
                    spreadPositions: [...(raw.arkuiComponentEvidence.argShape.spreadPositions || [])],
                },
            },
        });
        addEdge(edges, id, rootId, "supports");
    }

    if (raw.decoratorEvidence) {
        const id = "decorator";
        addNode(nodes, {
            id,
            kind: "decorator",
            label: raw.decoratorEvidence.decoratorName,
            status: "known",
            data: { ...raw.decoratorEvidence },
        });
        addEdge(edges, id, rootId, "supports");
    }

    if (raw.projectEvidence) {
        const id = "project-declaration";
        addNode(nodes, {
            id,
            kind: "project-declaration",
            label: raw.projectEvidence.memberName,
            status: "known",
            data: {
                ...raw.projectEvidence,
                exportPath: [...raw.projectEvidence.exportPath],
                ownerPath: [...raw.projectEvidence.ownerPath],
                parameterTypes: [...raw.projectEvidence.parameterTypes],
            },
        });
        addEdge(edges, id, rootId, "supports");
    }

    for (const hint of raw.officialEvidence || []) {
        const id = hint.kind === "arkui-component"
            ? `official-hint:component:${hint.componentName}`
            : `official-hint:decorator:${hint.decoratorName}`;
        addNode(nodes, {
            id,
            kind: "official-hint",
            label: hint.kind === "arkui-component" ? hint.componentName : hint.decoratorName,
            status: "known",
            data: { ...hint },
        });
        addEdge(edges, id, rootId, "supports");
    }

    if (!raw.importEvidence && raw.ir.unknownSignature && identityRecoveryUsuallyNeedsImport(raw.kind)) {
        missingEvidence.add("import_binding");
    }
    if (!raw.ir.arkanalyzerMethodKey && !raw.importEvidence && !raw.receiverEvidence && !raw.receiverAmbiguityEvidence && !raw.arkuiEvidence && !raw.arkuiComponentEvidence && !raw.decoratorEvidence && !raw.projectEvidence && !raw.officialEvidence?.length) {
        missingEvidence.add("identity_evidence");
    }

    return {
        occurrenceId: resolved.occurrenceId,
        rawOccurrenceId: raw.rawOccurrenceId,
        status: resolved.status,
        reasonCode: resolved.reason,
        canonicalApiId: resolved.canonicalApiId,
        nodes,
        edges,
        missingEvidence: [...missingEvidence].sort(),
    };
}

function addReceiverShapeNodes(
    nodes: OfficialOccurrenceEvidenceNode[],
    edges: OfficialOccurrenceEvidenceEdge[],
    rootId: string,
    raw: RawApiOccurrence,
): void {
    const evidence = raw.receiverEvidence;
    if (!evidence) return;
    const shape = evidence.argShape;
    addNode(nodes, {
        id: "receiver-shape:arity",
        kind: "shape-arity",
        label: String(shape.arity),
        status: "known",
        data: { arity: shape.arity },
    });
    addEdge(edges, "receiver-shape:arity", rootId, "has-shape");
    (shape.parameterTypes || []).forEach((type, index) => {
        const id = `receiver-shape:parameter-type:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-parameter-type",
            label: type,
            status: isUnknownEvidenceText(type) ? "unknown" : "known",
            data: { index, type },
        });
        addEdge(edges, id, rootId, "has-shape");
    });
    for (const item of shape.literalKinds || []) {
        const id = `receiver-shape:literal-kind:${item.index}`;
        addNode(nodes, {
            id,
            kind: "shape-literal-kind",
            label: item.kind,
            status: "known",
            data: { ...item },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const item of shape.objectKeys || []) {
        const id = `receiver-shape:object-keys:${item.index}`;
        addNode(nodes, {
            id,
            kind: "shape-object-keys",
            label: item.keys.join(","),
            status: "known",
            data: { index: item.index, keys: [...item.keys] },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const index of shape.callbackPositions || []) {
        const id = `receiver-shape:callback-position:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-callback-position",
            label: String(index),
            status: "known",
            data: { index },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const index of shape.spreadPositions || []) {
        const id = `receiver-shape:spread-position:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-spread-position",
            label: String(index),
            status: "known",
            data: { index },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
}

function identityRecoveryUsuallyNeedsImport(kind: RawApiOccurrence["kind"]): boolean {
    return kind === "invoke" || kind === "construct" || kind === "property-access";
}

function addMemberChainNodes(
    nodes: OfficialOccurrenceEvidenceNode[],
    edges: OfficialOccurrenceEvidenceEdge[],
    importId: string,
    memberChain: readonly string[],
): void {
    if (memberChain.length === 0) return;
    let previous = importId;
    memberChain.forEach((member, index) => {
        const id = `member-chain:${index}:${member}`;
        addNode(nodes, {
            id,
            kind: "member-chain",
            label: member,
            status: isUnknownEvidenceText(member) ? "unknown" : "known",
            data: { index, chain: [...memberChain] },
        });
        addEdge(edges, previous, id, "selects-member");
        previous = id;
    });
}

function addAliasNodes(
    nodes: OfficialOccurrenceEvidenceNode[],
    edges: OfficialOccurrenceEvidenceEdge[],
    importId: string,
    aliasChain: readonly string[],
): void {
    aliasChain.forEach((alias, index) => {
        const id = `alias:${index}:${alias}`;
        addNode(nodes, {
            id,
            kind: "alias",
            label: alias,
            status: isUnknownEvidenceText(alias) ? "unknown" : "known",
            data: { index, chain: [...aliasChain] },
        });
        addEdge(edges, importId, id, "has-alias");
    });
}

function addShapeNodes(
    nodes: OfficialOccurrenceEvidenceNode[],
    edges: OfficialOccurrenceEvidenceEdge[],
    rootId: string,
    raw: RawApiOccurrence,
): void {
    const evidence = raw.importEvidence;
    if (!evidence) return;
    const shape = evidence.argShape;
    addNode(nodes, {
        id: "shape:arity",
        kind: "shape-arity",
        label: String(shape.arity),
        status: "known",
        data: { arity: shape.arity },
    });
    addEdge(edges, "shape:arity", rootId, "has-shape");

    (shape.parameterTypes || []).forEach((type, index) => {
        const id = `shape:parameter-type:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-parameter-type",
            label: type,
            status: isUnknownEvidenceText(type) ? "unknown" : "known",
            data: { index, type },
        });
        addEdge(edges, id, rootId, "has-shape");
    });
    for (const item of shape.literalKinds || []) {
        const id = `shape:literal-kind:${item.index}`;
        addNode(nodes, {
            id,
            kind: "shape-literal-kind",
            label: item.kind,
            status: "known",
            data: { ...item },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const item of shape.objectKeys || []) {
        const id = `shape:object-keys:${item.index}`;
        addNode(nodes, {
            id,
            kind: "shape-object-keys",
            label: item.keys.join(","),
            status: "known",
            data: { index: item.index, keys: [...item.keys] },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const index of shape.callbackPositions || []) {
        const id = `shape:callback-position:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-callback-position",
            label: String(index),
            status: "known",
            data: { index },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
    for (const index of shape.spreadPositions || []) {
        const id = `shape:spread-position:${index}`;
        addNode(nodes, {
            id,
            kind: "shape-spread-position",
            label: String(index),
            status: "known",
            data: { index },
        });
        addEdge(edges, id, rootId, "has-shape");
    }
}

function addNode(nodes: OfficialOccurrenceEvidenceNode[], node: OfficialOccurrenceEvidenceNode): void {
    if (nodes.some(item => item.id === node.id)) return;
    nodes.push(node);
}

function addEdge(
    edges: OfficialOccurrenceEvidenceEdge[],
    from: string,
    to: string,
    kind: OfficialOccurrenceEvidenceEdgeKind,
): void {
    if (edges.some(item => item.from === from && item.to === to && item.kind === kind)) return;
    edges.push({ from, to, kind });
}

function isUnknownEvidenceText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    return text === "unknown"
        || text === "%unk"
        || text === "@unk"
        || text === "@%unk/%unk"
        || text.includes("%unk")
        || text.includes("@unk");
}
