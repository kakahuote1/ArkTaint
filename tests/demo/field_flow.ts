class Wrapper {
    data: string = "clean";
}

function source(): string {
    return "tainted_data";
}

function sink(data: string): void {
    console.log("Sink received:", data);
}

function main_field() {
    let w = new Wrapper();
    let t = source();
    w.data = t;      // Taint Store: w.data = tainted
    let y = w.data;  // Taint Load: y = w.data
    sink(y);         // Should detect
}
