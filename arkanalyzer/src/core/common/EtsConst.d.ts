export declare const ETS_COMPILER_OPTIONS: {
    ets: {
        emitDecorators: {
            name: string;
            emitParameters: boolean;
        }[];
        propertyDecorators: {
            name: string;
            needInitialization: boolean;
        }[];
        render: {
            method: string[];
            decorator: string[];
        };
        components: string[];
        extend: {
            decorator: string[];
            components: {
                name: string;
                type: string;
                instance: string;
            }[];
        };
        styles: {
            decorator: string;
            component: {
                name: string;
                type: string;
                instance: string;
            };
            property: string;
        };
        concurrent: {
            decorator: string;
        };
        customComponent: string;
        syntaxComponents: {
            paramsUICallback: string[];
            attrUICallback: {
                name: string;
                attributes: string[];
            }[];
        };
        libs: any[];
    };
};
export declare const COMPONENT_FOR_EACH: string;
export declare const COMPONENT_LAZY_FOR_EACH: string;
export declare const BUILDIN_SYSTEM_COMPONENT: Set<string>;
export declare const BUILDIN_ATOMIC_COMPONENT: Set<string>;
export declare const COMPONENT_DECORATOR: Set<string>;
export declare const ENTRY_DECORATOR: string;
export declare const BUILDER_DECORATOR: string;
export declare const BUILDER_PARAM_DECORATOR: string;
export declare const COMPONENT_BEHAVIOR: string;
export declare function isEtsAtomicComponent(name: string): boolean;
export declare function isEtsSystemComponent(name: string): boolean;
export declare function isEtsContainerComponent(name: string): boolean;
export declare const COMPONENT_CREATE_FUNCTION: string;
export declare const COMPONENT_POP_FUNCTION: string;
export declare const COMPONENT_CUSTOMVIEW: string;
export declare const COMPONENT_REPEAT: string;
export declare const COMPONENT_IF: string;
export declare const COMPONENT_IF_BRANCH: string;
export declare const COMPONENT_BRANCH_FUNCTION: string;
export declare const COMPONENT_BUILD_FUNCTION: string;
export declare const SPECIAL_CONTAINER_COMPONENT: Set<string>;
export declare const COMPONENT_COMMON: string;
export declare const COMPONENT_INSTANCE: string;
export declare const COMPONENT_ATTRIBUTE: string;
export declare const CALL_BACK: string;
export declare const ON_OFF: Set<string>;
export declare const OH_PACKAGE_JSON5 = "oh-package.json5";
export declare const BUILD_PROFILE_JSON5 = "build-profile.json5";
export declare const COMPONENT: string;
