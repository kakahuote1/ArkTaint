// Case: DatePicker, TimePicker, TextPicker, Select onChange/onSelect
// Real pattern: scheduling automation rules with picker-based UI
import { DatePicker, TimePicker, TextPicker, Select, taint } from "./taint_mock";

class AutomationScheduler {
    private selectedDate: string = "";
    private selectedTime: string = "";
    private selectedAction: string = "";
    private selectedRepeat: string = "";

    build(): void {
        const datePicker = new DatePicker();
        datePicker.onChange((value) => {
            this.selectedDate = `${value.year}-${value.month}-${value.day}`;
            taint.Sink(this.selectedDate);
        });

        const timePicker = new TimePicker();
        timePicker.onChange((value) => {
            this.selectedTime = `${value.hour}:${value.minute}`;
            taint.Sink(this.selectedTime);
        });

        const actionPicker = new TextPicker();
        actionPicker.onChange((value, index) => {
            this.selectedAction = value;
            taint.Sink(`action=${value}, index=${index}`);
        });

        const repeatSelector = new Select();
        repeatSelector.onSelect((index, value) => {
            this.selectedRepeat = value;
            taint.Sink(`repeat=${value}, index=${index}`);
            this.saveSchedule();
        });
    }

    private saveSchedule(): void {
        taint.Sink(`${this.selectedDate} ${this.selectedTime} ${this.selectedAction} ${this.selectedRepeat}`);
    }
}

export { AutomationScheduler };
