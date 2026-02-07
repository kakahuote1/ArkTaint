
import { CallSite } from "../../arkanalyzer/src/model/CallGraph";

export class TaintFlow {
    public source: string;
    public sink: CallSite;
    public path?: string[]; // Optional: for path reconstruction

    constructor(source: string, sink: CallSite, path?: string[]) {
        this.source = source;
        this.sink = sink;
        this.path = path;
    }

    public toString(): string {
        return `Flow: ${this.source} -> ${this.sink.toString()}`;
    }
}
