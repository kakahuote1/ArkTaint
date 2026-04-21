// NEGATIVE Case: Subclass of a user-defined base class (not a framework Ability)
// Even though this class has lifecycle-like methods and inherits from a base,
// the base is NOT a framework Ability class
import { taint } from "./taint_mock";

class BasePlugin {
    onCreate(): void {}
    onDestroy(): void {}
    onEnable(): void {}
    onDisable(): void {}
}

class LightPlugin extends BasePlugin {
    private brightness: number = 0;

    onCreate(): void {
        this.brightness = 100;
        taint.Sink(this.brightness);
    }

    onDestroy(): void {
        this.brightness = 0;
        taint.Sink("light_plugin_destroyed");
    }

    onEnable(): void {
        taint.Sink("light_enabled");
    }

    onDisable(): void {
        taint.Sink("light_disabled");
    }
}

class ThermostatPlugin extends BasePlugin {
    onCreate(): void {
        taint.Sink("thermostat_init");
    }

    onDestroy(): void {
        taint.Sink("thermostat_destroyed");
    }
}

export function non_framework_inheritance_035_F(): void {
    const light = new LightPlugin();
    light.onCreate();
    light.onEnable();
    light.onDisable();
    light.onDestroy();

    const thermostat = new ThermostatPlugin();
    thermostat.onCreate();
    thermostat.onDestroy();
}
