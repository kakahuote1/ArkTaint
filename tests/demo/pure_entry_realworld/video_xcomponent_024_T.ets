// Case: Video player with full lifecycle callbacks + XComponent for custom rendering
// Real pattern: security camera feed with custom overlay rendering
import { Video, XComponent, CanvasRenderingContext2D, taint } from "./taint_mock";

class CameraFeedPage {
    private currentTime: number = 0;
    private duration: number = 0;
    private renderingContext: CanvasRenderingContext2D | null = null;

    build(): void {
        const video = new Video();
        video.onPrepared((event) => {
            this.duration = event.duration;
            taint.Sink(this.duration);
        });
        video.onStart(() => {
            taint.Sink("playback_started");
        });
        video.onPause(() => {
            taint.Sink("playback_paused");
        });
        video.onFinish(() => {
            taint.Sink("playback_finished");
            this.loadNextClip();
        });
        video.onError(() => {
            taint.Sink("playback_error");
        });
        video.onSeeking((event) => {
            taint.Sink(event.time);
        });
        video.onUpdate((event) => {
            this.currentTime = event.time;
            this.drawOverlay(event.time);
        });

        // XComponent for native rendering overlay
        const xComponent = new XComponent();
        xComponent.onLoad((context: any) => {
            this.renderingContext = context;
            taint.Sink(context);
            this.initOverlay();
        });
        xComponent.onDestroy(() => {
            this.renderingContext = null;
        });
    }

    aboutToAppear(): void {
        taint.Sink("camera_feed_loading");
    }

    private drawOverlay(timestamp: number): void {
        if (this.renderingContext) {
            this.renderingContext.fillText(`T: ${timestamp}`, 10, 20);
        }
    }

    private initOverlay(): void {
        taint.Sink("overlay_initialized");
    }

    private loadNextClip(): void {
        taint.Sink("loading_next");
    }
}

export { CameraFeedPage };
