// Case: Worker and TaskPool with structured message protocol
// Background processing for device data with multiple message handlers
import { Worker, TaskPool, taint } from "./taint_mock";

function processDeviceData(rawData: string): string {
    taint.Sink(rawData);
    return rawData + "_processed";
}

class DeviceMonitorService {
    private worker: Worker;

    constructor() {
        this.worker = new Worker();
    }

    build(): void {
        this.worker.onMessage((msg: any) => {
            const payload = msg?.data;
            taint.Sink(payload);
            this.handleWorkerMessage(msg?.type, payload);
        });

        this.worker.onError((err: any) => {
            taint.Sink(err);
        });

        // TaskPool for CPU-intensive work
        TaskPool.execute(processDeviceData, taint.Source());

        TaskPool.execute((config: string) => {
            taint.Sink(config);
        }, "sensor_config");

        // Send initial command to worker
        this.worker.postMessage({ type: "start_monitoring", interval: 1000 });
    }

    private handleWorkerMessage(type: string, data: any): void {
        switch (type) {
            case "sensor_update":
                taint.Sink(data);
                break;
            case "alert":
                taint.Sink(data);
                break;
        }
    }
}

export { DeviceMonitorService, processDeviceData };
