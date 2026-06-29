import {
    result,
    type AssetEndpoint,
    type HandoffHandle,
    type HandoffHandleTemplate,
    type HandleKeyPartTemplate,
    type SemanticEffectConsumer,
    type SemanticEffectInstance,
    type ValidationResult,
} from "../schema";

export type EndpointValueResolver = (endpoint: AssetEndpoint) => string | undefined;

export class HandoffEffectConsumer implements SemanticEffectConsumer {
    readonly family: string = "handoff";
    readonly mode = "during-fixpoint" as const;

    accepts(kind: SemanticEffectInstance["kind"]): boolean {
        return kind === "handoff.put"
            || kind === "handoff.get"
            || kind === "handoff.kill"
            || kind === "handoff.link";
    }

    validate(instance: SemanticEffectInstance): ValidationResult {
        if (!this.accepts(instance.kind)) {
            return result([`HandoffEffectConsumer does not accept ${instance.kind}`]);
        }
        return result([]);
    }
}

export function instantiateHandoffHandleTemplate(
    template: HandoffHandleTemplate,
    resolveEndpoint: EndpointValueResolver,
): HandoffHandle {
    const scope = instantiateParts(template.scope || [], resolveEndpoint);
    const key = instantiateParts(template.key, resolveEndpoint);
    const owner = template.owner ? instantiateParts(template.owner, resolveEndpoint) : undefined;
    assertExactResolvedParts([...scope, ...key, ...(owner || [])]);
    return {
        cellKind: template.cellKind,
        family: template.family,
        scope,
        key,
        owner,
        index: template.index,
        precision: "exact",
    };
}

function instantiateParts(
    parts: HandleKeyPartTemplate[],
    resolveEndpoint: EndpointValueResolver,
): string[] {
    return parts.map(part => instantiatePart(part, resolveEndpoint));
}

function instantiatePart(
    part: HandleKeyPartTemplate,
    resolveEndpoint: EndpointValueResolver,
): string {
    switch (part.kind) {
        case "const":
            return part.value;
        case "fromEndpoint":
            return resolveEndpoint(part.endpoint) || "<unknown>";
        case "fromEndpointPath":
            return resolveEndpoint({
                base: part.endpoint.base,
                accessPath: [...(part.endpoint.accessPath || []), ...part.accessPath],
            }) || "<unknown>";
        case "fromLiteralArg":
            return resolveEndpoint({ base: { kind: "arg", index: part.index } }) || "<unknown>";
        case "fromRouteTarget":
            return "<route-target>";
        case "fromCallbackChannel":
            return "<callback-channel>";
        case "unknown":
        default:
            return "<unknown>";
    }
}

function assertExactResolvedParts(parts: string[]): void {
    const unknown = parts.find(part => part === "<unknown>");
    if (unknown !== undefined) {
        throw new Error("handoff handle template could not be resolved exactly");
    }
}
