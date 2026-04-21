// NEGATIVE Case: Plain class with lifecycle-named methods but NO Ability inheritance
// Engine should NOT treat this as an entry point
import { taint } from "./taint_mock";

class DeviceController {
    private status: string = "idle";

    // These look like lifecycle methods but this class is NOT an Ability
    onCreate(): void {
        this.status = "created";
        taint.Sink(this.status);
    }

    onDestroy(): void {
        this.status = "destroyed";
        taint.Sink(this.status);
    }

    onForeground(): void {
        taint.Sink("foreground");
    }

    onBackground(): void {
        taint.Sink("background");
    }

    // Also has build() but is NOT a @Component
    build(): void {
        taint.Sink("building");
    }
}

export function plain_class_lifecycle_names_019_F(): void {
    const controller = new DeviceController();
    controller.onCreate();
    controller.build();
    controller.onDestroy();
}
