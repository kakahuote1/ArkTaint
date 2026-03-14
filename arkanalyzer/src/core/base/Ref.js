"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClosureFieldRef = exports.GlobalRef = exports.ArkCaughtExceptionRef = exports.ArkThisRef = exports.ArkParameterRef = exports.ArkStaticFieldRef = exports.ArkInstanceFieldRef = exports.AbstractFieldRef = exports.ArkArrayRef = exports.AbstractRef = void 0;
const logger_1 = __importStar(require("../../utils/logger"));
const Type_1 = require("./Type");
const TypeInference_1 = require("../common/TypeInference");
const Stmt_1 = require("./Stmt");
const IRInference_1 = require("../common/IRInference");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Ref');
/**
 * @category core/base/ref
 */
class AbstractRef {
    inferType(arkMethod) {
        return this;
    }
}
exports.AbstractRef = AbstractRef;
class ArkArrayRef extends AbstractRef {
    constructor(base, index) {
        super();
        this.base = base;
        this.index = index;
    }
    /**
     * Returns the base of this array reference. Array reference refers to access to array elements.
     * Array references usually consist of an local variable and an index.
     * For example, `a[i]` is a typical array reference, where `a` is the base (i.e., local variable)
     * pointing to the actual memory location where the array is stored
     * and `i` is the index indicating access to the `i-th` element from array `a`.
     * @returns the base of this array reference.
     * @example
     * 1. Get the base and the specific elements.

     ```typescript
     // Create an array
     let myArray: number[] = [10, 20, 30, 40];
     // Create an ArrayRef object representing a reference to myArray[2]
     let arrayRef = new ArkArrayRef(myArray, 2);
     // Use the getBase() method to get the base of the array
     let baseArray = arrayRef.getBase();

     console.log("Base array:", baseArray);  // Output: Base array: [10, 20, 30, 40]

     // Use baseArray and obeject index of ArrayRef to access to specific array elements
     let element = baseArray[arrayRef.index];
     console.log("Element at index", arrayRef.index, ":", element);  // Output: Element at index 2 : 30
     ```
     */
    getBase() {
        return this.base;
    }
    setBase(newBase) {
        this.base = newBase;
    }
    /**
     * Returns the index of this array reference.
     * In TypeScript, an array reference means that the variable stores
     * the memory address of the array rather than the actual data of the array.
     * @returns The index of this array reference.
     */
    getIndex() {
        return this.index;
    }
    setIndex(newIndex) {
        this.index = newIndex;
    }
    getType() {
        let baseType = TypeInference_1.TypeInference.replaceTypeWithReal(this.base.getType());
        if (baseType instanceof Type_1.ArrayType) {
            return baseType.getBaseType();
        }
        else {
            logger.warn(`the type of base in ArrayRef is not ArrayType`);
            return Type_1.UnknownType.getInstance();
        }
    }
    getUses() {
        let uses = [];
        uses.push(this.base);
        uses.push(...this.base.getUses());
        uses.push(this.index);
        uses.push(...this.index.getUses());
        return uses;
    }
    toString() {
        return this.base + '[' + this.index + ']';
    }
}
exports.ArkArrayRef = ArkArrayRef;
class AbstractFieldRef extends AbstractRef {
    constructor(fieldSignature) {
        super();
        this.fieldSignature = fieldSignature;
    }
    /**
     * Returns the the field name as a **string**.
     * @returns The the field name.
     */
    getFieldName() {
        return this.fieldSignature.getFieldName();
    }
    /**
     * Returns a field signature, which consists of a class signature,
     * a **string** field name, and a **boolean** label indicating whether it is static or not.
     * @returns The field signature.
     * @example
     * 1. Compare two Fields

     ```typescript
     const fieldSignature = new FieldSignature();
     fieldSignature.setFieldName(...);
     const fieldRef = new ArkInstanceFieldRef(baseValue as Local, fieldSignature);
     ...
     if (fieldRef.getFieldSignature().getFieldName() ===
     targetField.getFieldSignature().getFieldName()) {
     ...
     }
     ```
     */
    getFieldSignature() {
        return this.fieldSignature;
    }
    setFieldSignature(newFieldSignature) {
        this.fieldSignature = newFieldSignature;
    }
    getType() {
        return this.fieldSignature.getType();
    }
}
exports.AbstractFieldRef = AbstractFieldRef;
class ArkInstanceFieldRef extends AbstractFieldRef {
    constructor(base, fieldSignature, dynamic = false) {
        super(fieldSignature);
        this.base = base;
        if (dynamic) {
            this.dynamic = dynamic;
        }
    }
    isDynamic() {
        return this.dynamic || false;
    }
    /**
     * Returns the local of field, showing which object this field belongs to.
     * A {@link Local} consists of :
     * - Name: the **string** name of local value, e.g., "$temp0".
     * - Type: the type of value.
     * @returns The object that the field belongs to.
     * @example
     * 1. Get a base.

     ```typescript
     if (expr instanceof ArkInstanceFieldRef) {
     ...
     let base = expr.getBase();
     if (base.getName() == 'this') {
     ...
     }
     ...
     }
     ```
     */
    getBase() {
        return this.base;
    }
    setBase(newBase) {
        this.base = newBase;
    }
    getUses() {
        let uses = [];
        uses.push(this.base);
        uses.push(...this.base.getUses());
        return uses;
    }
    toString() {
        return this.base.toString() + '.<' + this.getFieldSignature() + '>';
    }
    inferType(arkMethod) {
        return IRInference_1.IRInference.inferFieldRef(this, arkMethod);
    }
}
exports.ArkInstanceFieldRef = ArkInstanceFieldRef;
class ArkStaticFieldRef extends AbstractFieldRef {
    constructor(fieldSignature) {
        super(fieldSignature);
    }
    getUses() {
        return [];
    }
    toString() {
        return this.getFieldSignature().toString();
    }
}
exports.ArkStaticFieldRef = ArkStaticFieldRef;
class ArkParameterRef extends AbstractRef {
    constructor(index, paramType) {
        super();
        this.index = index;
        this.paramType = paramType;
    }
    getIndex() {
        return this.index;
    }
    setIndex(index) {
        this.index = index;
    }
    getType() {
        return this.paramType;
    }
    setType(newType) {
        this.paramType = newType;
    }
    inferType(arkMethod) {
        return IRInference_1.IRInference.inferParameterRef(this, arkMethod);
    }
    getUses() {
        return [];
    }
    toString() {
        return 'parameter' + this.index + ': ' + this.paramType;
    }
}
exports.ArkParameterRef = ArkParameterRef;
class ArkThisRef extends AbstractRef {
    constructor(type) {
        super();
        this.type = type;
    }
    getType() {
        return this.type;
    }
    getUses() {
        return [];
    }
    toString() {
        return 'this: ' + this.type;
    }
}
exports.ArkThisRef = ArkThisRef;
class ArkCaughtExceptionRef extends AbstractRef {
    constructor(type) {
        super();
        this.type = type;
    }
    getType() {
        return this.type;
    }
    getUses() {
        return [];
    }
    toString() {
        return 'caughtexception: ' + this.type;
    }
}
exports.ArkCaughtExceptionRef = ArkCaughtExceptionRef;
class GlobalRef extends AbstractRef {
    constructor(name, ref) {
        super();
        this.name = name;
        this.ref = ref ?? null;
        this.usedStmts = [];
    }
    getName() {
        return this.name;
    }
    getUses() {
        return this.ref?.getUses() || [];
    }
    getType() {
        return this.ref?.getType() || Type_1.UnknownType.getInstance();
    }
    getRef() {
        return this.ref || null;
    }
    setRef(value) {
        this.ref = value;
    }
    getUsedStmts() {
        return this.usedStmts;
    }
    addUsedStmts(usedStmts) {
        if (usedStmts instanceof Stmt_1.Stmt) {
            this.usedStmts.push(usedStmts);
        }
        else {
            usedStmts.forEach(stmt => this.usedStmts.push(stmt));
        }
    }
    toString() {
        return this.getName();
    }
}
exports.GlobalRef = GlobalRef;
class ClosureFieldRef extends AbstractRef {
    constructor(base, fieldName, type) {
        super();
        this.base = base;
        this.fieldName = fieldName;
        this.type = type;
    }
    getUses() {
        return [];
    }
    getBase() {
        return this.base;
    }
    getType() {
        return this.type;
    }
    setType(type) {
        this.type = type;
    }
    getFieldName() {
        return this.fieldName;
    }
    toString() {
        return this.base.toString() + '.' + this.getFieldName();
    }
    inferType(arkMethod) {
        if (TypeInference_1.TypeInference.isUnclearType(this.type)) {
            let type = this.base.getType();
            if (type instanceof Type_1.LexicalEnvType) {
                type = type
                    .getClosures()
                    .find(c => c.getName() === this.fieldName)
                    ?.getType();
            }
            if (type && !TypeInference_1.TypeInference.isUnclearType(type)) {
                this.type = type;
            }
        }
        return this;
    }
}
exports.ClosureFieldRef = ClosureFieldRef;
//# sourceMappingURL=Ref.js.map