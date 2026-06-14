import { MessageParcel, taint } from "./taint_mock";

export function sink_ipc_messageparcel_write_006_T(userInput: string): void {
    const parcel = new MessageParcel();
    parcel.writeString(taint.Source() + userInput);
}
