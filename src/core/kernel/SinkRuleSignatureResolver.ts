import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { RuleMatchKind, SinkRule } from "../rules/RuleSchema";

export function resolveSinkRuleSignatures(scene: Scene, rule: SinkRule): string[] {
    const methods = scene.getMethods();
    const value = rule.match.value || "";
    const normalizedValue = normalizeExactMatchText(value);
    const matchKind: RuleMatchKind =
        (rule.match.kind as string) === "callee_signature_equals" ? "signature_equals" : rule.match.kind;
    switch (matchKind) {
        case "signature_contains":
            return [value];
        case "signature_equals": {
            if (!normalizedValue) return [];
            const matched = methods
                .map(m => m.getSignature().toString())
                .filter(sig => normalizeExactMatchText(sig) === normalizedValue);
            if (matched.length > 0) return [...new Set(matched)];
            return [normalizedValue];
        }
        case "declaring_class_equals": {
            if (!normalizedValue) return [];
            const matched = methods
                .filter(m => {
                    const classSig = m.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
                    const className = m.getDeclaringArkClass?.()?.getName?.() || "";
                    return normalizeExactMatchText(classSig) === normalizedValue
                        || normalizeExactMatchText(className) === normalizedValue;
                })
                .map(m => m.getSignature().toString());
            return [...new Set(matched)];
        }
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
            {
                const matched = methods
                .filter(m => m.getName() === value)
                .map(m => m.getSignature().toString());
                // Fallback for unresolved/framework calls represented as
                // "@%unk/%unk: .methodName()" in ArkIR where no concrete
                // method symbol exists in scene.
                matched.push(`.${value}(`);
                return [...new Set(matched)];
            }
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

function normalizeExactMatchText(value: string): string {
    return value.trim();
}
