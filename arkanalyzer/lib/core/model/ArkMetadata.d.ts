import { FullPosition } from '../base/Position';
export declare enum ArkMetadataKind {
    LEADING_COMMENTS = 0,
    TRAILING_COMMENTS = 1,
    ENUM_INIT_TYPE_USER = 2
}
export interface ArkMetadataType {
}
/**
 * ArkMetadata
 * @example
 * // get leading comments
 * let stmt: Stmt = xxx;
 * let comments = stmt.getMetadata(ArkMetadataKind.LEADING_COMMENTS) || [];
 * comments.forEach((comment) => {
 *   logger.info(comment);
 * });
 */
export declare class ArkMetadata {
    protected metadata?: Map<ArkMetadataKind, ArkMetadataType>;
    getMetadata(kind: ArkMetadataKind): ArkMetadataType | undefined;
    setMetadata(kind: ArkMetadataKind, value: ArkMetadataType): void;
}
export type CommentItem = {
    content: string;
    position: FullPosition;
};
export declare class CommentsMetadata implements ArkMetadataType {
    private comments;
    constructor(comments: CommentItem[]);
    getComments(): CommentItem[];
}
export declare class EnumInitTypeUserMetadata implements ArkMetadataType {
    private originTypeUser;
    constructor(originTypeUser: boolean);
    isUserDefined(): boolean;
}
//# sourceMappingURL=ArkMetadata.d.ts.map