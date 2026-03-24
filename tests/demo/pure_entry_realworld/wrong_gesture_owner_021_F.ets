// NEGATIVE Case: Gesture-like methods on a non-framework class
// Engine should NOT treat custom onAction/onActionEnd methods as gesture entries
import { taint } from "./taint_mock";

class DeviceAction {
    private actionName: string;

    constructor(name: string) {
        this.actionName = name;
    }

    // Looks like TapGesture.onAction but is a regular method on a custom class
    onAction(data: string): void {
        taint.Sink(data);
    }

    // Looks like PanGesture.onActionEnd but is NOT a gesture
    onActionEnd(): void {
        taint.Sink(this.actionName + " ended");
    }
}

class FakeGestureProcessor {
    // Has onChange like TextInput but is not a UI component
    onChange(value: string): void {
        taint.Sink(value);
    }

    // Has onClick like Button but is not a UI component
    onClick(event: any): void {
        taint.Sink(event);
    }
}

export function wrong_gesture_owner_021_F(): void {
    const action = new DeviceAction("toggle_light");
    action.onAction("user_triggered");
    action.onActionEnd();

    const processor = new FakeGestureProcessor();
    processor.onChange("some_value");
    processor.onClick({ fake: true });
}
