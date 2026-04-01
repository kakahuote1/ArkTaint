OpenHarmony app projects containing potential privacy leaks.

The projects in this directory are test cases for potential data leakage risks, covering 66 different test scenarios across 7 categories. They can be used as a benchmark for taint analysis scenarios. The 7 categories are:

- **Aliasing**: Data flow related to alias analysis.
- **Anonymous Constructs**: Issues related to anonymous classes and functions.
- **Array-Like Structure**: Array-related issues, including arrays, sets, and maps.
- **Field And Object Sensitivity**: Field and object sensitivity-related issues.
- **General Language Features**: General ArkTS syntax issues, including closures, `try-catch`, inheritance, and polymorphism.
- **OpenHarmony Specific APIs**: HarmonyOS API-related issues, primarily showcasing different APIs that can be used as sources.
- **LifeCycle Modeling**: Lifecycle functions and event callbacks.

**Note**: The content within each scenario is not a complete project. It's extracted from xxx (project name)/entry/src/main/ets/.