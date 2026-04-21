// Case: Canvas onReady with drawing operations
// Real pattern: real-time device status visualization on a canvas
import { Canvas, CanvasRenderingContext2D, taint } from "./taint_mock";

class DeviceStatusCanvas {
    private context: CanvasRenderingContext2D | null = null;
    private sensorValues: number[] = [];

    build(): void {
        const canvas = new Canvas();
        canvas.onReady(() => {
            this.context = new CanvasRenderingContext2D();
            this.drawStatusChart();
        });
    }

    aboutToAppear(): void {
        // poll sensor data
        setInterval(() => {
            const newValue = Math.random() * 100;
            this.sensorValues.push(newValue);
            taint.Sink(newValue);
            this.drawStatusChart();
        }, 1000);
    }

    private drawStatusChart(): void {
        if (!this.context) return;
        const ctx = this.context;
        // clear and redraw
        ctx.fillRect(0, 0, 400, 300);
        for (let i = 0; i < this.sensorValues.length; i++) {
            const value = this.sensorValues[i];
            ctx.fillRect(i * 10, 300 - value, 8, value);
            ctx.fillText(String(value), i * 10, 300 - value - 5);
        }
        taint.Sink(this.sensorValues.length);
    }
}

export { DeviceStatusCanvas };
