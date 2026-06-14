import { RemoteObject, taint } from "./taint_mock";

export function sink_rpc_sendRequest_001_T(userInput: string): void {
    const remote = new RemoteObject();
    const data = taint.Source() + userInput;
    remote.sendRequest(1, data, {}, {});
}
