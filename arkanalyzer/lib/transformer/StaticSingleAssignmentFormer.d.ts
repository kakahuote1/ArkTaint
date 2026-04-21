import { ArkBody } from '../core/model/ArkBody';
export declare class StaticSingleAssignmentFormer {
    transformBody(body: ArkBody): void;
    private transformStmt;
    private decideBlockToPhiStmts;
    private handleDf;
    private handleBlockWithSucc;
    private addPhiStmts;
    private renameUseAndDef;
    private renameLocals;
    private removeVisitedTree;
    private constainsPhiExpr;
    private getOriginalLocal;
    private addNewArgToPhi;
    private containsAllChildren;
    private createEmptyPhiStmt;
}
//# sourceMappingURL=StaticSingleAssignmentFormer.d.ts.map