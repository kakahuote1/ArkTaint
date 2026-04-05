export function buildExecutionHandoffSiteKeyFromRecord(record: {
    callerSignature: string;
    lineNo: number;
    invokeText: string;
}): string {
    return `${record.callerSignature}#${record.lineNo}#${record.invokeText}`;
}

export function buildExecutionHandoffSiteKeyFromStmt(caller: any, stmt: any): string {
    const callerSignature = caller?.getSignature?.()?.toString?.()
        || stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.()
        || "";
    const lineNo = stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    const invokeText = stmt?.toString?.() || "";
    return `${callerSignature}#${lineNo}#${invokeText}`;
}
