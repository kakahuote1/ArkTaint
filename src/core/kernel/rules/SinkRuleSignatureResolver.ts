import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { RuleMatchKind, SinkRule } from "../../rules/RuleSchema";

interface MethodSignatureIndexEntry {
    signature: string;
    normalizedSignature: string;
    name: string;
    classTexts: string[];
}

interface MethodSignatureIndex {
    entries: MethodSignatureIndexEntry[];
    signatures: string[];
    byName: Map<string, string[]>;
    byNormalizedSignature: Map<string, string[]>;
    byNormalizedClassText: Map<string, string[]>;
}

const sinkSignatureIndexCache: WeakMap<Scene, MethodSignatureIndex> = new WeakMap();

export function resolveSinkRuleSignatures(scene: Scene, rule: SinkRule): string[] {
    const index = getOrBuildMethodSignatureIndex(scene);
    const value = rule.match.value || "";
    const normalizedValue = normalizeExactMatchText(value);
    const matchKind: RuleMatchKind =
        (rule.match.kind as string) === "callee_signature_equals" ? "signature_equals" : rule.match.kind;
    switch (matchKind) {
        case "signature_contains":
            return [value];
        case "signature_equals": {
            if (!normalizedValue) return [];
            const matched = index.byNormalizedSignature.get(normalizedValue) || [];
            if (matched.length > 0) return [...new Set(matched)];
            return [normalizedValue];
        }
        case "declaring_class_equals": {
            if (!normalizedValue) return [];
            const matched = index.byNormalizedClassText.get(normalizedValue) || [];
            return [...new Set(matched)];
        }
        case "signature_regex": {
            let re: RegExp;
            try {
                re = new RegExp(value);
            } catch {
                return [];
            }
            return index.signatures.filter(sig => re.test(sig));
        }
        case "method_name_equals":
            {
                const matched = [...(index.byName.get(value) || [])];
                // Fallback for unresolved/framework calls represented as
                // "@%unk/%unk: .methodName()" in ArkIR where no concrete
                // method symbol exists in scene.
                if (matched.length === 0) {
                    matched.push(`.${value}(`);
                }
                return [...new Set(matched)];
            }
        case "method_name_regex": {
            let re: RegExp;
            try {
                re = new RegExp(value);
            } catch {
                return [];
            }
            return index.entries
                .filter(entry => re.test(entry.name))
                .map(entry => entry.signature);
        }
        case "local_name_regex":
            return [];
        default:
            return [];
    }
}

function getOrBuildMethodSignatureIndex(scene: Scene): MethodSignatureIndex {
    const cached = sinkSignatureIndexCache.get(scene);
    if (cached) return cached;

    const entries: MethodSignatureIndexEntry[] = [];
    const signatures: string[] = [];
    const byName = new Map<string, string[]>();
    const byNormalizedSignature = new Map<string, string[]>();
    const byNormalizedClassText = new Map<string, string[]>();
    const seenSignatures = new Set<string>();

    for (const method of scene.getMethods()) {
        const signature = safeSignatureText(method?.getSignature?.());
        if (!signature) continue;
        const name = String(method?.getName?.() || "");
        const arkClass = method?.getDeclaringArkClass?.();
        const classTexts = [
            safeSignatureText(arkClass?.getSignature?.()),
            String(arkClass?.getName?.() || ""),
        ].filter((text): text is string => text.length > 0);
        const entry = {
            signature,
            normalizedSignature: normalizeExactMatchText(signature),
            name,
            classTexts,
        };
        entries.push(entry);
        if (!seenSignatures.has(signature)) {
            seenSignatures.add(signature);
            signatures.push(signature);
        }
        addMapValue(byName, name, signature);
        addMapValue(byNormalizedSignature, entry.normalizedSignature, signature);
        for (const classText of classTexts) {
            addMapValue(byNormalizedClassText, normalizeExactMatchText(classText), signature);
        }
    }

    const built = {
        entries,
        signatures,
        byName,
        byNormalizedSignature,
        byNormalizedClassText,
    };
    sinkSignatureIndexCache.set(scene, built);
    return built;
}

function addMapValue(map: Map<string, string[]>, key: string, value: string): void {
    if (!key || !value) return;
    const existing = map.get(key);
    if (existing) {
        if (!existing.includes(value)) existing.push(value);
        return;
    }
    map.set(key, [value]);
}

function safeSignatureText(signatureLike: any): string {
    try {
        return String(signatureLike?.toString?.() || "").trim();
    } catch {
        return "";
    }
}

function normalizeExactMatchText(value: string): string {
    return value.trim();
}
