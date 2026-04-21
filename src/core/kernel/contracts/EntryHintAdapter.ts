export interface KernelEntryHint {
    methodSignature?: string;
    phase?: string;
    factKind?: string;
    metadata?: Record<string, unknown>;
}

export interface EntryHintAdapter<TPlan = unknown> {
    toKernelHints(plan: TPlan): KernelEntryHint[];
}
