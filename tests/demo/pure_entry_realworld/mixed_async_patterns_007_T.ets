// Case: Mixed async patterns in a single component
// Real apps combine timers, promises, microtasks, and animation callbacks
import { taint, animateTo } from "./taint_mock";

class DashboardPage {
    private pollTimer: number = 0;
    private retryCount: number = 0;
    private animating: boolean = false;
    private sensorData: string = "";

    build(): void {
        // schedule periodic polling
        this.pollTimer = setInterval(() => {
            this.fetchSensorData();
        }, 5000);

        // one-shot delayed initialization
        setTimeout(() => {
            const config = taint.Source();
            taint.Sink(config);
        }, 100);

        // animation with state change on finish
        animateTo({ duration: 300, onFinish: () => {
            this.animating = false;
            taint.Sink(this.sensorData);
        }}, () => {
            this.animating = true;
        });

        // microtask for priority work
        queueMicrotask(() => {
            const urgent = taint.Source();
            this.processSensorReading(urgent);
        });

        // promise chain
        this.loadRemoteConfig()
            .then((config: string) => {
                taint.Sink(config);
                return this.applyConfig(config);
            })
            .then((result: string) => {
                taint.Sink(result);
            });

        // requestAnimationFrame for smooth UI update
        requestAnimationFrame(() => {
            taint.Sink(this.sensorData);
        });
    }

    aboutToAppear(): void {
        this.sensorData = taint.Source();
    }

    private fetchSensorData(): void {
        const data = taint.Source();
        this.sensorData = data;
        taint.Sink(data);
    }

    private processSensorReading(reading: string): void {
        taint.Sink(reading);
    }

    private loadRemoteConfig(): Promise<string> {
        return Promise.resolve(taint.Source());
    }

    private applyConfig(config: string): Promise<string> {
        return Promise.resolve(config + "_applied");
    }
}

export { DashboardPage };
