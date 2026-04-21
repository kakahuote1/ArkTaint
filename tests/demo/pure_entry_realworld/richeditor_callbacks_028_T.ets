// Case: RichEditor with input, selection, deletion, and paste callbacks
// Real pattern: device note editor with rich text editing
import { RichEditor, taint } from "./taint_mock";

class DeviceNoteEditor {
    private content: string = "";

    build(): void {
        const editor = new RichEditor();

        editor.onReady(() => {
            taint.Sink("editor_ready");
            this.loadSavedNote();
        });

        editor.onSelect((value) => {
            taint.Sink(`selected: ${value.start}-${value.end}`);
        });

        editor.aboutToIMEInput((value: any) => {
            taint.Sink(value);
            // return true to allow input, false to block
            return this.validateInput(value);
        });

        editor.onIMEInputComplete((value: any) => {
            this.content += String(value);
            taint.Sink(this.content);
        });

        editor.aboutToDelete((value: any) => {
            taint.Sink(value);
            return true;
        });

        editor.onDeleteComplete(() => {
            taint.Sink("deletion_complete");
        });

        editor.onPaste(() => {
            taint.Sink("paste_detected");
            this.handlePaste();
        });
    }

    private loadSavedNote(): void {
        this.content = taint.Source();
    }

    private validateInput(input: any): boolean {
        taint.Sink(input);
        return true;
    }

    private handlePaste(): void {
        taint.Sink("processing_paste");
    }
}

export { DeviceNoteEditor };
