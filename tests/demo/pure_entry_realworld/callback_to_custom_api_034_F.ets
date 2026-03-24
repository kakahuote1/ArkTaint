// NEGATIVE Case: Callbacks registered to a custom (non-framework) API
// Engine should NOT treat callbacks passed to user-defined APIs as entry points
import { taint } from "./taint_mock";

class CustomEventBus {
    private handlers: Map<string, ((data: any) => void)[]> = new Map();

    on(event: string, handler: (data: any) => void): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
    }

    emit(event: string, data: any): void {
        for (const handler of this.handlers.get(event) || []) {
            handler(data);
        }
    }
}

class CustomTimer {
    private callback: (() => void) | null = null;
    private interval: number = 0;

    schedule(callback: () => void, intervalMs: number): void {
        this.callback = callback;
        this.interval = intervalMs;
    }

    cancel(): void {
        this.callback = null;
    }
}

class DevicePoller {
    private bus: CustomEventBus;
    private timer: CustomTimer;

    constructor() {
        this.bus = new CustomEventBus();
        this.timer = new CustomTimer();
    }

    build(): void {
        // These are callbacks to CUSTOM classes, not framework APIs
        this.bus.on("device_update", (data: any) => {
            taint.Sink(data);
        });

        this.bus.on("error", (err: any) => {
            taint.Sink(err);
        });

        this.timer.schedule(() => {
            taint.Sink("custom_timer_tick");
        }, 5000);
    }
}

export function callback_to_custom_api_034_F(): void {
    const poller = new DevicePoller();
    poller.build();
}
