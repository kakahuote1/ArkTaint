import { Stmt } from '../base/Stmt';
import { Fact } from './Fact';
export declare class DataflowResult {
    stmt2InFacts: Map<Stmt, Fact>;
    stmt2OutFacts: Map<Stmt, Fact>;
    globalFacts: Set<Fact>;
}
//# sourceMappingURL=DataflowResult.d.ts.map