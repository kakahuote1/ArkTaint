import { asset, taint } from "./taint_mock";

export function sink_security_asset_add_007_T(userInput: string): void {
    asset.add({
        alias: "token",
        secret: taint.Source() + userInput,
    });
}
