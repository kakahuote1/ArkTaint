import ts from 'ohos-typescript';
export type LineCol = number;
export declare function setLine(lineCol: LineCol, lineNo: number): LineCol;
export declare function setCol(lineCol: LineCol, colNo: number): LineCol;
export declare function setLineCol(lineNo: number, colNo: number): LineCol;
export declare function getLineNo(lineCol: LineCol): number;
export declare function getColNo(lineCol: LineCol): number;
/**
 * @category core/base
 */
export declare class LineColPosition {
    private readonly lineCol;
    static readonly DEFAULT: LineColPosition;
    constructor(lineNo: number, colNo: number);
    getLineNo(): number;
    getColNo(): number;
    static buildFromNode(node: ts.Node, sourceFile: ts.SourceFile): LineColPosition;
}
export declare class FullPosition {
    private readonly first;
    private readonly last;
    static readonly DEFAULT: FullPosition;
    constructor(firstLine: number, firstCol: number, lastLine: number, lastCol: number);
    getFirstLine(): number;
    getLastLine(): number;
    getFirstCol(): number;
    getLastCol(): number;
    static buildFromNode(node: ts.Node, sourceFile: ts.SourceFile): FullPosition;
    static merge(leftMostPosition: FullPosition, rightMostPosition: FullPosition): FullPosition;
}
//# sourceMappingURL=Position.d.ts.map