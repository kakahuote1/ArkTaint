import { collectSdkOverrideCandidates as collectSdkDeclarationOverrides } from "../../core/entry/arkmain/facts/ArkMainSdkDeclarationDiscovery";
import { collectSdkOverrideCandidates as collectStructuralOverrides } from "../../core/entry/arkmain/facts/ArkMainStructuralDiscovery";
import { resolveAbilityLikeOwnerKind } from "../../core/entry/arkmain/facts/ArkMainFactResolverUtils";

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

type FakeClass = ReturnType<typeof createClass>;
type FakeMethod = ReturnType<typeof createMethod>;

function createMethod(name: string, declaringClassRef: () => FakeClass): any {
    return {
        getName: () => name,
        isStatic: () => false,
        isPrivate: () => false,
        isGenerated: () => false,
        isAnonymousMethod: () => false,
        containsModifier: () => false,
        getDeclaringArkClass: declaringClassRef,
        getSignature: () => ({
            toString: () => `${declaringClassRef().name}.${name}`,
        }),
    };
}

function createClass(name: string, fileSig: string): any {
    const methods: FakeMethod[] = [];
    let superClass: FakeClass | undefined;
    return {
        name,
        getName: () => name,
        getSuperClassName: () => superClass?.name || "",
        getSuperClass: () => superClass,
        setSuperClass: (next: FakeClass | undefined) => {
            superClass = next;
        },
        getMethods: () => methods,
        addMethod: (methodName: string) => {
            const method = createMethod(methodName, () => cls);
            methods.push(method);
            return method;
        },
        getAllMethodsWithName: () => {
            throw new RangeError("recursive class hierarchy expansion");
        },
        getDeclaringArkFile: () => ({
            getFileSignature: () => fileSig,
        }),
        getSignature: () => ({
            toString: () => `class:${fileSig}:${name}`,
        }),
    };

    function cls(): FakeClass {
        return undefined as never;
    }
}

function createFakeClass(name: string, fileSig: string): FakeClass {
    const cls = createClass(name, fileSig);
    cls.addMethod = (methodName: string) => {
        const method = createMethod(methodName, () => cls);
        cls.getMethods().push(method);
        return method;
    };
    return cls;
}

function createScene(sdkFileSigs: string[]): any {
    const sdkFiles = new Set(sdkFileSigs);
    return {
        hasSdkFile: (fileSig: unknown) => sdkFiles.has(String(fileSig)),
        getClasses: () => [],
    };
}

function main(): void {
    const cycleA = createFakeClass("CycleA", "project/cycleA.ets");
    const cycleB = createFakeClass("CycleB", "project/cycleB.ets");
    cycleA.setSuperClass(cycleB);
    cycleB.setSuperClass(cycleA);
    cycleA.addMethod("onCreate");

    assert(resolveAbilityLikeOwnerKind(cycleA as never) === undefined, "cyclic local inheritance should not resolve as ability owner");
    assert(collectStructuralOverrides(createScene([]), [cycleA as never]).length === 0, "structural override discovery should tolerate cycles");
    assert(collectSdkDeclarationOverrides(createScene([]), [cycleA as never]).length === 0, "SDK declaration discovery should tolerate cycles");

    const appClass = createFakeClass("EntryAbility", "project/entry.ets");
    const sdkAbility = createFakeClass("UIAbility", "sdk/uiability.d.ts");
    sdkAbility.addMethod("onCreate");
    appClass.setSuperClass(sdkAbility);
    const appOnCreate = appClass.addMethod("onCreate");
    const scene = createScene(["sdk/uiability.d.ts"]);

    const structural = collectStructuralOverrides(scene, [appClass as never]);
    const declaration = collectSdkDeclarationOverrides(scene, [appClass as never]);
    assert(structural.length === 1 && structural[0]!.method === appOnCreate, "structural override discovery should find direct SDK base methods");
    assert(declaration.length === 1 && declaration[0]!.method === appOnCreate, "SDK declaration discovery should find direct SDK base methods");

    console.log("PASS test_entry_model_class_hierarchy_guard");
}

main();
