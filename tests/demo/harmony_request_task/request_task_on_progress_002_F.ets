function Sink(value: any): void {
    console.log(value);
}

class DownloadTask {
    on(_event: string, _callback: (payload: any) => void): void {}
}

export function request_task_on_progress_002_F(): void {
    const task = new DownloadTask();
    task.on("progress", progress => {
        Sink(progress);
    });
}
