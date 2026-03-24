const SLOT_PREFIX = "$c$:";

export function toContainerFieldKey(slot: string): string {
    return `${SLOT_PREFIX}${slot}`;
}

export function fromContainerFieldKey(field: string): string | null {
    if (!field.startsWith(SLOT_PREFIX)) return null;
    return field.slice(SLOT_PREFIX.length);
}
