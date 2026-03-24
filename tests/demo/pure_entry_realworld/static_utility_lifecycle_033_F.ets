// NEGATIVE Case: Static utility class with methods named like lifecycle callbacks
// Static methods should NOT be treated as implicit entry points
import { taint } from "./taint_mock";

class DeviceUtils {
    // Static methods with lifecycle-like names — NOT entry points
    static onCreate(config: string): any {
        taint.Sink(config);
        return { initialized: true };
    }

    static onDestroy(instance: any): void {
        taint.Sink(instance);
    }

    static build(components: string[]): string {
        taint.Sink(components);
        return components.join(",");
    }

    static onForeground(): void {
        taint.Sink("static_foreground");
    }

    // Also static helper that looks like a callback
    static onChange(oldValue: string, newValue: string): void {
        taint.Sink(`${oldValue} -> ${newValue}`);
    }

    static onClick(target: string): void {
        taint.Sink(target);
    }
}

export function static_utility_lifecycle_033_F(): void {
    DeviceUtils.onCreate("test_config");
    DeviceUtils.build(["sensor", "light"]);
    DeviceUtils.onChange("off", "on");
    DeviceUtils.onClick("button_1");
    DeviceUtils.onDestroy({ id: "dev1" });
}
