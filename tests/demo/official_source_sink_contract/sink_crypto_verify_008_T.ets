import { taint, Verify } from "./taint_mock";

export function sink_crypto_verify_008_T(userInput: string): void {
    const verifier = new Verify();
    verifier.verify(taint.Source() + userInput);
}
