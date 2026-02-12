
class A {
    data: string;
    clean: string;
    constructor(t: string) {
        this.data = t;
        this.clean = "_";
    }
}

function source(): string {
    return "tainted";
}

function sink(data: string) {
    console.log("Sink called with:", data);
}

function benchmark_field_001() {
    let s = source();
    let a = new A(s);
    sink(a.data);
}
