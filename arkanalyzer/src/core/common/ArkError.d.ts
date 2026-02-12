export declare enum ArkErrorCode {
    OK = 0,
    CLASS_INSTANCE_FIELD_UNDEFINED = -1,
    BB_MORE_THAN_ONE_BRANCH_RET_STMT = -2,
    BB_BRANCH_RET_STMT_NOT_AT_END = -3,
    CFG_NOT_FOUND_START_BLOCK = -4,
    CFG_HAS_UNREACHABLE_BLOCK = -5,
    METHOD_SIGNATURE_UNDEFINED = -6,
    METHOD_SIGNATURE_LINE_UNMATCHED = -7
}
export interface ArkError {
    errCode: ArkErrorCode;
    errMsg?: string;
}
