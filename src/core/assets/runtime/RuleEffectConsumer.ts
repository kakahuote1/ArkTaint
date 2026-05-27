import { result, type SemanticEffectConsumer, type SemanticEffectInstance, type SemanticEmission, type ValidationResult } from "../schema";

export class RuleEffectConsumer implements SemanticEffectConsumer {
    readonly family: string = "rule";
    readonly mode = "pre-analysis" as const;

    accepts(kind: SemanticEffectInstance["kind"]): boolean {
        return kind === "rule.source"
            || kind === "rule.sink"
            || kind === "rule.sanitizer"
            || kind === "rule.transfer";
    }

    validate(instance: SemanticEffectInstance): ValidationResult {
        if (!this.accepts(instance.kind)) {
            return result([`RuleEffectConsumer does not accept ${instance.kind}`]);
        }
        return result([]);
    }

    consumeBatch(instances: SemanticEffectInstance[]): SemanticEmission[] {
        return instances.map(instance => {
            const base = {
                emissionId: `${instance.id}:${instance.kind}`,
                effectInstanceId: instance.id,
                modelId: instance.modelId,
                bindingId: instance.bindingId,
                templateId: instance.templateId,
                location: instance.location,
            };
            switch (instance.kind) {
                case "rule.source":
                    return { ...base, kind: "analysis.source" as const };
                case "rule.sink":
                    return { ...base, kind: "analysis.sink" as const };
                case "rule.sanitizer":
                    return { ...base, kind: "analysis.sanitizer" as const };
                case "rule.transfer":
                    return { ...base, kind: "analysis.transfer" as const };
                default:
                    throw new Error(`unsupported rule effect kind ${instance.kind}`);
            }
        });
    }
}
