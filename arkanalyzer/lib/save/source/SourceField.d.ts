import { ArkField } from '../../core/model/ArkField';
import { SourceBase } from './SourceBase';
/**
 * @category save
 */
export declare class SourceField extends SourceBase {
    private field;
    private transformer;
    private initializer;
    constructor(field: ArkField, indent: string | undefined, initializer: Map<string, string>);
    getLine(): number;
    dump(): string;
}
//# sourceMappingURL=SourceField.d.ts.map