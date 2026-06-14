import { taint, WebDataBase } from "./taint_mock";

export function sink_webdatabase_saveHttpAuthCredentials_004_T(userInput: string): void {
    const db = new WebDataBase();
    const username = userInput;
    const password = taint.Source();
    db.saveHttpAuthCredentials("example.com", "admin", username, password);
}
