import { Stmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { CallSite } from "../../arkanalyzer/out/src/callgraph/model/CallSite";

export interface TaintFlowMeta {
    sourceRuleId?: string;
    sinkRuleId?: string;
    sinkEndpoint?: string;
    sinkNodeId?: number;
    sinkFieldPath?: string[];
    transferRuleIds?: string[];
}

export class TaintFlow {
    public source: string;
    public sink: Stmt;
    public sourceRuleId?: string;
    public sinkRuleId?: string;
    public sinkEndpoint?: string;
    public sinkNodeId?: number;
    public sinkFieldPath?: string[];
    public transferRuleIds?: string[];

    constructor(source: string, sink: Stmt, meta: TaintFlowMeta = {}) {
        this.source = source;
        this.sink = sink;
        this.sourceRuleId = meta.sourceRuleId;
        this.sinkRuleId = meta.sinkRuleId;
        this.sinkEndpoint = meta.sinkEndpoint;
        this.sinkNodeId = meta.sinkNodeId;
        this.sinkFieldPath = meta.sinkFieldPath;
        this.transferRuleIds = meta.transferRuleIds;
    }

    public toString(): string {
        return `Flow: ${this.source} -> ${this.sink.toString()}`;
    }
}
