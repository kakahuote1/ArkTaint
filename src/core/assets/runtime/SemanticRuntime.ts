import type { AnalysisContext, SemanticEffectConsumer, SemanticEffectInstance, SemanticEmission } from "../schema";

export class SemanticRuntime {
    private readonly consumers: SemanticEffectConsumer[];

    constructor(consumers: SemanticEffectConsumer[]) {
        this.consumers = [...consumers];
    }

    consumeBatch(instances: SemanticEffectInstance[], context: AnalysisContext = {}): SemanticEmission[] {
        const emissions: SemanticEmission[] = [];
        for (const instance of instances) {
            const consumers = this.consumers.filter(consumer => consumer.accepts(instance.kind));
            if (consumers.length === 0) {
                throw new Error(`no semantic effect consumer registered for ${instance.kind}`);
            }
            if (consumers.length > 1) {
                throw new Error(`multiple semantic effect consumers registered for ${instance.kind}`);
            }
            const consumer = consumers[0];
            const validation = consumer.validate(instance);
            if (!validation.valid) {
                throw new Error(`invalid semantic effect instance ${instance.id}: ${validation.errors.join("; ")}`);
            }
            if (!consumer.consumeBatch) {
                throw new Error(`consumer ${consumer.family} cannot batch-consume ${instance.kind}`);
            }
            emissions.push(...consumer.consumeBatch([instance], context));
        }
        return emissions;
    }
}
