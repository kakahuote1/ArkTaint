import type { AssetBinding, AssetEndpoint, CoreCapabilityTemplate, SemanticEffectTemplate } from "../../assets/schema";
import type { ResolvedApiOccurrence } from "../occurrence";
import type { ApiEffectIdentity, ApiEffectInstance, ApiEffectRole, ResolvedEndpointBinding } from "../ApiOccurrenceIdentity";

export interface BindingProjectionInput {
    occurrence: ResolvedApiOccurrence;
    binding: AssetBinding;
    template: SemanticEffectTemplate;
    endpoint?: AssetEndpoint;
}

export interface EffectProjectionDiagnostic {
    kind: string;
    message: string;
}

export function projectBindingToEffect(input: BindingProjectionInput): ApiEffectInstance {
    const canonicalApiId = input.occurrence.canonicalApiId;
    if (!canonicalApiId) {
        throw new Error(`accepted API effect occurrence ${input.occurrence.occurrenceId} has no canonicalApiId`);
    }
    if (!input.binding.canonicalApiId) {
        throw new Error(`asset binding ${input.binding.bindingId} has no canonicalApiId`);
    }
    if (input.binding.canonicalApiId !== canonicalApiId) {
        throw new Error(
            `asset binding ${input.binding.bindingId} canonicalApiId does not match occurrence ${input.occurrence.occurrenceId}`,
        );
    }
    const role = apiEffectRoleFromBinding(input.binding);
    const identity: ApiEffectIdentity = {
        canonicalApiId,
        assetId: input.binding.assetId,
        surfaceId: input.binding.surfaceId,
        bindingId: input.binding.bindingId,
        effectTemplateId: input.template.id,
        role,
    };
    const endpointBindings = endpointBindingsFromTemplate(
        input.template,
        input.endpoint || input.binding.endpoint,
        canonicalApiId,
    );
    const endpointStatus = endpointBindings.length > 0 ? "exact" : "unresolved";
    return {
        effectInstanceId: [
            "effect",
            input.occurrence.occurrenceId,
            input.binding.bindingId,
            input.template.id,
        ].join(":"),
        occurrenceId: input.occurrence.occurrenceId,
        rawOccurrenceId: input.occurrence.rawOccurrenceId,
        identity,
        endpointBindings,
        guardStatus: input.binding.guard ? "accepted" : "accepted",
        endpointStatus,
        acceptedForPropagation: input.occurrence.status === "accepted" && endpointStatus === "exact",
        diagnostics: endpointStatus === "exact"
            ? []
            : [{ kind: "endpoint_unresolved", message: "binding/template does not declare all required endpoints" }],
    };
}

function apiEffectRoleFromBinding(binding: AssetBinding): ApiEffectRole {
    if (binding.role === "source"
        || binding.role === "sink"
        || binding.role === "sanitizer"
        || binding.role === "transfer") {
        return binding.role;
    }
    if (binding.role === "entry") return "arkmain";
    return "module";
}

function endpointBindingsFromTemplate(
    template: SemanticEffectTemplate,
    bindingEndpoint?: AssetEndpoint,
    canonicalApiId?: string,
): ApiEffectInstance["endpointBindings"] {
    if (template.kind === "rule.transfer") {
        const from = endpointBindingFromRuleValue(template.from, "from");
        const to = endpointBindingFromRuleValue(template.to, "to");
        if (!from || !to) return [];
        return [from, to];
    }
    if (template.kind === "module.eventEmitter") {
        return endpointBindingsFromModuleEventEmitterTemplate(template, canonicalApiId, bindingEndpoint);
    }
    if (template.kind === "core.capability") {
        return endpointBindingsFromCoreCapabilityTemplate(template, canonicalApiId, bindingEndpoint);
    }
    const endpoint = bindingEndpoint || endpointFromTemplate(template);
    return endpoint ? [{ endpoint, status: "exact" }] : [];
}

function endpointBindingsFromCoreCapabilityTemplate(
    template: CoreCapabilityTemplate,
    canonicalApiId?: string,
    bindingEndpoint?: AssetEndpoint,
): ResolvedEndpointBinding[] {
    if (bindingEndpoint) {
        return [{ endpoint: bindingEndpoint, valueRef: "endpoint", status: "exact" }];
    }
    if (template.capability !== "module.keyed-storage") return [];
    const apiId = String(canonicalApiId || "").trim();
    if (!apiId) return [];
    const out: ResolvedEndpointBinding[] = [];
    for (const api of objectArray(template.payload.writeApis)) {
        if (!canonicalApiGroupMatches(api, apiId)) continue;
        const valueIndex = integerValue((api as any).valueIndex);
        if (valueIndex !== undefined) {
            out.push({ endpoint: { base: { kind: "arg", index: valueIndex } }, valueRef: "write", status: "exact" });
        }
    }
    for (const api of objectArray(template.payload.writeResultApis)) {
        if (!canonicalApiGroupMatches(api, apiId)) continue;
        const valueIndex = integerValue((api as any).valueIndex);
        if (valueIndex !== undefined) {
            out.push({ endpoint: { base: { kind: "arg", index: valueIndex } }, valueRef: "write-result-default", status: "exact" });
        }
        out.push({ endpoint: { base: { kind: "return" } }, valueRef: "write-result-return", status: "exact" });
    }
    if (stringArray(template.payload.readCanonicalApiIds).includes(apiId)) {
        out.push({ endpoint: { base: { kind: "return" } }, valueRef: "read", status: "exact" });
    }
    if (stringArray(template.payload.killCanonicalApiIds).includes(apiId)) {
        out.push({ endpoint: { base: { kind: "arg", index: 0 } }, valueRef: "kill", status: "exact" });
    }
    return out;
}

function canonicalApiGroupMatches(value: unknown, canonicalApiId: string): boolean {
    return stringArray((value as any)?.canonicalApiIds).includes(canonicalApiId);
}

function objectArray(value: unknown): any[] {
    return Array.isArray(value) ? value.filter(item => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
}

function integerValue(value: unknown): number | undefined {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function endpointBindingsFromModuleEventEmitterTemplate(
    template: Extract<SemanticEffectTemplate, { kind: "module.eventEmitter" }>,
    canonicalApiId?: string,
    bindingEndpoint?: AssetEndpoint,
): ResolvedEndpointBinding[] {
    const apiId = String(canonicalApiId || "").trim();
    if (!apiId) return [];
    const out: ResolvedEndpointBinding[] = [];
    if (template.onCanonicalApiIds.includes(apiId)) {
        const callbackArgIndex = integerOrDefault(template.callbackArgIndex, 1);
        out.push({
            endpoint: bindingEndpoint || { base: { kind: "arg", index: callbackArgIndex } },
            valueRef: "registration",
            status: "exact",
        });
    }
    if (template.emitCanonicalApiIds.includes(apiId)) {
        const payloadArgIndex = integerOrDefault(template.payloadArgIndex, 1);
        const channelArgIndexes = (template.channelArgIndexes || [])
            .filter(Number.isInteger)
            .sort((left, right) => left - right);
        const activationArgIndex = channelArgIndexes[0] ?? 0;
        out.push({
            endpoint: bindingEndpoint || {
                base: {
                    kind: "arg",
                    index: payloadArgIndex >= 0 ? payloadArgIndex : activationArgIndex,
                },
            },
            valueRef: payloadArgIndex >= 0 ? "payload" : "activation",
            status: "exact",
        });
    }
    return out;
}

function integerOrDefault(value: unknown, defaultValue: number): number {
    return Number.isInteger(value) ? value as number : defaultValue;
}

function endpointFromTemplate(template: SemanticEffectTemplate): AssetEndpoint | undefined {
    switch (template.kind) {
        case "rule.source":
            return endpointFromRuleValue(template.value);
        case "rule.sink":
        case "rule.sanitizer":
            return template.value ? endpointFromRuleValue(template.value) : undefined;
        case "rule.transfer":
            return endpointFromRuleValue(template.to);
        case "handoff.put":
            return template.value;
        case "handoff.get":
            return template.target;
        case "handoff.kill":
            return endpointFromHandoffHandleKey(template);
        case "entry.scheduleUnit":
            return template.unit;
        case "entry.frameworkInvoke":
            return template.target;
        default:
            return undefined;
    }
}

function endpointFromHandoffHandleKey(template: Extract<SemanticEffectTemplate, { kind: "handoff.kill" }>): AssetEndpoint | undefined {
    const parts = Array.isArray(template.handle?.key) ? template.handle.key : [];
    const endpoints = parts
        .map(endpointFromHandleKeyPart)
        .filter((endpoint): endpoint is AssetEndpoint => !!endpoint);
    if (endpoints.length !== 1) return undefined;
    return endpoints[0];
}

function endpointFromHandleKeyPart(part: any): AssetEndpoint | undefined {
    if (!part || typeof part !== "object") return undefined;
    if (part.kind === "fromLiteralArg" && Number.isInteger(part.index) && part.index >= 0) {
        return { base: { kind: "arg", index: part.index } };
    }
    if (part.kind === "fromEndpoint" && part.endpoint && typeof part.endpoint === "object") {
        return part.endpoint as AssetEndpoint;
    }
    if (part.kind === "fromEndpointPath" && part.endpoint && typeof part.endpoint === "object") {
        const endpoint = part.endpoint as AssetEndpoint;
        return {
            ...endpoint,
            accessPath: [
                ...(endpoint.accessPath || []),
                ...(Array.isArray(part.accessPath) ? part.accessPath : []),
            ],
        };
    }
    return undefined;
}

function endpointFromRuleValue(value: any): AssetEndpoint | undefined {
    if (!value || typeof value !== "object") return undefined;
    if (value.endpoint && typeof value.endpoint === "object") return value.endpoint as AssetEndpoint;
    if (value.base && typeof value.base === "object") return value as AssetEndpoint;
    return undefined;
}

function endpointBindingFromRuleValue(value: any, valueRef: string): ResolvedEndpointBinding | undefined {
    if (!value || typeof value !== "object") return undefined;
    if (value.endpoint && typeof value.endpoint === "object") {
        return {
            endpoint: value.endpoint as AssetEndpoint,
            pathFrom: value.pathFrom && typeof value.pathFrom === "object" ? value.pathFrom as AssetEndpoint : undefined,
            slotKind: typeof value.slotKind === "string" ? value.slotKind : undefined,
            slotWriteMode: value.slotWriteMode === "replace" || value.slotWriteMode === "append" ? value.slotWriteMode : undefined,
            taintScope: value.taintScope === "self" || value.taintScope === "contained-values" ? value.taintScope : undefined,
            valueRef,
            status: "exact",
        };
    }
    if (value.base && typeof value.base === "object") {
        return {
            endpoint: value as AssetEndpoint,
            valueRef,
            status: "exact",
        };
    }
    return undefined;
}
