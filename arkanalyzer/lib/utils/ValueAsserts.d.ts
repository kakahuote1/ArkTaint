export declare class ValueAsserts {
    static ENABLE: boolean;
    static enable(): void;
    static disable(): void;
    static assert(cond: boolean, msg?: string): any;
    static assertDefined(val: any, msg?: string): asserts val;
    static assertNotEmptyArray(val: any[], msg?: string): asserts val;
}
//# sourceMappingURL=ValueAsserts.d.ts.map