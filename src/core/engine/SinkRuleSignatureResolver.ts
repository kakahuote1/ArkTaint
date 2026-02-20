import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SinkRule } from "../rules/RuleSchema";

export function resolveSinkRuleSignatures(scene: Scene, rule: SinkRule): string[] {
    const methods = scene.getMethods();
    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "signature_contains":
            return [value];
        case "signature_regex": {
            let re: RegExp;
            try {
                re = new RegExp(value);
            } catch {
                return [];
            }
            return methods
                .map(m => m.getSignature().toString())
                .filter(sig => re.test(sig));
        }
        case "method_name_equals":
            return methods
                .filter(m => m.getName() === value)
                .map(m => m.getSignature().toString());
        case "method_name_regex": {
            let re: RegExp;
            try {
                re = new RegExp(value);
            } catch {
                return [];
            }
            return methods
                .filter(m => re.test(m.getName()))
                .map(m => m.getSignature().toString());
        }
        case "local_name_regex":
            return [];
        default:
            return [];
    }
}
