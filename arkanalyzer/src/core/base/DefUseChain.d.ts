import { Value } from './Value';
import { Stmt } from './Stmt';
export declare class DefUseChain {
    value: Value;
    def: Stmt;
    use: Stmt;
    constructor(value: Value, def: Stmt, use: Stmt);
}
