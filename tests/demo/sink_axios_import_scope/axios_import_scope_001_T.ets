import axios from "@ohos/axios";
import { taint } from "./taint_mock";

export function axios_import_scope_001_T(userInput: string): void {
    const seed = userInput;
    axios.get("https://example.com/search?q=" + seed);
    axios.post("https://example.com/post", { body: seed });
}
