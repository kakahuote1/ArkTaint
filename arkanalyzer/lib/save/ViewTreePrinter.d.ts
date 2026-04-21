import { ViewTree } from '../core/graph/ViewTree';
import { Printer } from './Printer';
export declare class ViewTreePrinter extends Printer {
    private viewTree;
    private dupCnt;
    constructor(viewTree: ViewTree);
    dump(): string;
    private walk;
    private escapeDotLabel;
    private writeNode;
    private writeNodeStateValues;
    private writeNodeAttributes;
    private writeNodeSignature;
}
//# sourceMappingURL=ViewTreePrinter.d.ts.map