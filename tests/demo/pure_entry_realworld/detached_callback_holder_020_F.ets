// NEGATIVE Case: Callback lambda defined but never registered to any framework API
// Just stored in a variable — engine should NOT treat as an entry point
import { taint } from "./taint_mock";

class UnregisteredCallbackHolder {
    private handler: ((value: string) => void) | null = null;

    build(): void {
        // This lambda is defined but never passed to onClick / onChange / etc.
        const orphanCallback = (value: string): void => {
            taint.Sink(value);
        };

        // Store it but never register it
        this.handler = orphanCallback;

        // Another unregistered lambda
        const detachedLogger = (msg: string): void => {
            taint.Sink(msg);
        };

        // Called directly — NOT a framework callback registration
        detachedLogger("direct_call");
    }
}

export function detached_callback_holder_020_F(): void {
    const holder = new UnregisteredCallbackHolder();
    holder.build();
}
