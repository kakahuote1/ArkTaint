@Component
struct PasswordInput {
    private value: string = "";

    setPassword(next: string): void {
        this.value = next;
    }

    build() {}
}
