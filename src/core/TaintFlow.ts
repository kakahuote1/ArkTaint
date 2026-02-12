import { Stmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { CallSite } from "../../arkanalyzer/out/src/callgraph/model/CallSite";

export class TaintFlow {
    public source: string;
    public sink: Stmt;

    constructor(source: string, sink: Stmt) {
        this.source = source;
        this.sink = sink;
    }

    public toString(): string {
        return `Flow: ${this.source} -> ${this.sink.toString()}`;
    }
}
