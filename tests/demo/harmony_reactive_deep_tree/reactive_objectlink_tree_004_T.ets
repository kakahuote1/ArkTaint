import { ObjectLink, State, TokenModel, Watch, taint } from "./taint_mock";

class GrandChild004 {
    @ObjectLink
    model: TokenModel = new TokenModel();

    @Watch("model")
    onModelWatch(): void {
        taint.Sink(this.model.token);
    }
}

class ParentPage004 {
    @State
    model: TokenModel = new TokenModel();

    build(): void {
        this.model.token = taint.Source();
    }
}

export function reactive_objectlink_tree_004_T(): void {
    void GrandChild004;
    void ParentPage004;
}
