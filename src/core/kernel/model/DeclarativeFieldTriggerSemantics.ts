export interface DeclarativeFieldTriggerSpec {
    decoratorKind: string;
    targetField: string;
}

const OFFICIAL_DECLARATIVE_FIELD_TRIGGER_DECORATORS = new Set([
    "Watch",
    "Monitor",
]);

export function collectDeclarativeFieldTriggerSpecs(
    decorators: any[],
): DeclarativeFieldTriggerSpec[] {
    const specs: DeclarativeFieldTriggerSpec[] = [];
    for (const decorator of decorators || []) {
        const decoratorKind = normalizeDeclarativeFieldTriggerDecoratorKind(
            decorator?.getKind?.(),
        );
        if (!decoratorKind) continue;
        const fromParam = normalizeDeclarativeFieldTriggerToken(
            decorator?.getParam?.(),
        );
        if (fromParam !== undefined) {
            specs.push({ decoratorKind, targetField: fromParam });
            continue;
        }
        const fromContent = extractDeclarativeFieldTriggerTokenFromContent(
            decorator?.getContent?.(),
        );
        if (fromContent !== undefined) {
            specs.push({ decoratorKind, targetField: fromContent });
            continue;
        }
        specs.push({ decoratorKind, targetField: "" });
    }
    return specs;
}

export function collectQualifiedDeclarativeFieldTriggerSpecsForMethod(
    method: any,
): DeclarativeFieldTriggerSpec[] {
    const declaringClass = method?.getDeclaringArkClass?.();
    if (!isQualifiedDeclarativeFieldTriggerOwner(declaringClass)) {
        return [];
    }
    return collectDeclarativeFieldTriggerSpecs(method?.getDecorators?.() || [])
        .filter(spec => spec.targetField.length > 0)
        .filter(spec => isQualifiedDeclarativeFieldTriggerField(
            declaringClass?.getFieldWithName?.(spec.targetField),
        ));
}

export function resolveDeclarativeFieldTriggerToken(
    decorators: any[],
): string | undefined {
    const first = collectDeclarativeFieldTriggerSpecs(decorators)[0];
    return first?.targetField;
}

export function resolveQualifiedDeclarativeFieldTriggerToken(
    method: any,
): string | undefined {
    const first = collectQualifiedDeclarativeFieldTriggerSpecsForMethod(method)[0];
    return first?.targetField;
}

function normalizeDeclarativeFieldTriggerDecoratorKind(
    rawKind: any,
): string | undefined {
    const text = String(rawKind || "").replace(/^@+/, "").trim();
    if (!text) return undefined;
    return OFFICIAL_DECLARATIVE_FIELD_TRIGGER_DECORATORS.has(text)
        ? text
        : undefined;
}

export function normalizeDeclarativeFieldTriggerToken(
    raw: any,
): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw).trim();
    if (!text) return undefined;
    const m = text.match(/^["'`](.+)["'`]$/);
    return m ? m[1] : text;
}

export function extractDeclarativeFieldTriggerTokenFromContent(
    content: any,
): string | undefined {
    if (content === undefined || content === null) return undefined;
    const text = String(content).trim();
    if (!text) return undefined;
    const m = text.match(/["'`](.+?)["'`]/);
    if (!m) return undefined;
    return normalizeDeclarativeFieldTriggerToken(m[1]);
}

function isQualifiedDeclarativeFieldTriggerOwner(cls: any): boolean {
    return Boolean(
        cls?.hasEntryDecorator?.()
        || cls?.hasComponentDecorator?.(),
    );
}

function isQualifiedDeclarativeFieldTriggerField(field: any): boolean {
    const decorators = field?.getStateDecorators?.() || [];
    return decorators.length > 0;
}
