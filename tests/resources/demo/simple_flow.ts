// Simple demo ArkTS file for testing taint analysis

function source(): string {
    return "tainted_data";
}

function sink(data: string): void {
    console.log("Sink received:", data);
}

function main() {
    let x = source();  // Taint source
    sink(x);           // Should detect: source -> sink
}

main();
