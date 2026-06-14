export function console_variadic_arg1_001_T(userInput: string): void {
  console.info("label", userInput);
}

export function console_variadic_arg1_safe_002_F(userInput: string): void {
  const unused = userInput;
  console.info("label", "safe");
  void unused;
}
