import { ArkMethod } from '../../core/model/ArkMethod';
import { SourceBase } from './SourceBase';
import { SourceStmt } from './SourceStmt';
import { ArkNamespace } from '../../core/model/ArkNamespace';
/**
 * @category save
 */
export declare class SourceMethod extends SourceBase {
    private method;
    private transformer;
    constructor(method: ArkMethod, indent?: string);
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    setInBuilder(inBuilder: boolean): void;
    dump(): string;
    getLine(): number;
    dumpDefaultMethod(): SourceStmt[];
    private printMethod;
    private printBody;
    private methodProtoToString;
    toArrowFunctionTypeString(): string;
    private initInBuilder;
}
//# sourceMappingURL=SourceMethod.d.ts.map