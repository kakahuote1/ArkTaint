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
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyofTypeExpr = exports.TypeQueryExpr = exports.AbstractTypeExpr = void 0;
const ArkMethod_1 = require("../model/ArkMethod");
const Type_1 = require("./Type");
const IRInference_1 = require("../common/IRInference");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const ModelUtils_1 = require("../common/ModelUtils");
const ArkClass_1 = require("../model/ArkClass");
const Local_1 = require("./Local");
const TypeInference_1 = require("../common/TypeInference");
/**
 * abstract type expr represents the type operations of types or values.
 * AbstractTypeExpr is different from AbstractExpr.
 * @category core/base/typeExpr
 * @extends Type
 * @example
 *  ```typescript
 *  let a = number;
 *  type A = typeof a;
 *  let b: keyof typeof a;
 *  ```
 */
class AbstractTypeExpr extends Type_1.Type {
    inferType(arkMethod) {
        return;
    }
}
exports.AbstractTypeExpr = AbstractTypeExpr;
/**
 * typeQuery type expr represents the get type of value with typeof.
 * @category core/base/typeExpr
 * @extends AbstractTypeExpr
 * @example
 ```typescript
 // opValue is a and type A is number
 let a = number;
 type A = typeof a;
 ```
 */
class TypeQueryExpr extends AbstractTypeExpr {
    constructor(opValue, generateTypes) {
        super();
        this.opValue = opValue;
        this.genericTypes = generateTypes;
    }
    setOpValue(opValue) {
        this.opValue = opValue;
    }
    getOpValue() {
        return this.opValue;
    }
    setGenerateTypes(types) {
        this.genericTypes = types;
    }
    getGenerateTypes() {
        return this.genericTypes;
    }
    addGenericType(gType) {
        if (!this.genericTypes) {
            this.genericTypes = [];
        }
        this.genericTypes.push(gType);
    }
    getUses() {
        const opValue = this.getOpValue();
        if (opValue instanceof ArkBaseModel_1.ArkBaseModel) {
            return [];
        }
        let uses = [];
        uses.push(opValue);
        uses.push(...opValue.getUses());
        return uses;
    }
    getType() {
        const opValue = this.getOpValue();
        if (opValue instanceof ArkBaseModel_1.ArkBaseModel) {
            return ModelUtils_1.ModelUtils.parseArkBaseModel2Type(opValue) ?? Type_1.UnknownType.getInstance();
        }
        return this.genericTypes ? TypeInference_1.TypeInference.replaceTypeWithReal(opValue.getType(), this.genericTypes) : opValue.getType();
    }
    getTypeString() {
        const opValue = this.getOpValue();
        const gTypes = this.getGenerateTypes();
        const genericStr = gTypes && gTypes.length > 0 ? `<${gTypes.join(',')}>` : '';
        if (opValue instanceof ArkClass_1.ArkClass || opValue instanceof ArkMethod_1.ArkMethod) {
            return `typeof ${opValue.getSignature().toString()}${genericStr}`;
        }
        else if (opValue instanceof Local_1.Local) {
            const type = TypeInference_1.TypeInference.replaceTypeWithReal(opValue.getType(), gTypes);
            return `typeof ${type.toString()}`;
        }
        return `typeof ${opValue.toString()}${genericStr}`;
    }
    inferType(arkMethod) {
        IRInference_1.IRInference.inferTypeQueryExpr(this, arkMethod);
    }
}
exports.TypeQueryExpr = TypeQueryExpr;
/**
 * keyof type expr represents the type operator with keyof.
 * It should be an internal expr.
 * the final type should be transferred to union type, unless it cannot find out all types within the union type.
 * @category core/base/typeExpr
 * @extends AbstractTypeExpr
 * @example
 ```typescript
 // opType is {a: 1, b: 2} and type of A is KeyofTypeExpr, which can be transferred to union type {'a', 'b'}
 type A = keyof {a: 1, b: 2};

 // opType is number and type of B is KeyofTypeExpr, which can be transferred to union type "toString" | "toFixed" | "toExponential" | ...
 type B = keyof number;
 ```
 */
class KeyofTypeExpr extends AbstractTypeExpr {
    constructor(opType) {
        super();
        this.opType = opType;
    }
    getOpType() {
        return this.opType;
    }
    setOpType(opType) {
        this.opType = opType;
    }
    getUses() {
        let uses = [];
        if (this.getOpType() instanceof TypeQueryExpr) {
            uses.push(...this.getOpType().getUses());
        }
        return uses;
    }
    getType() {
        return this;
    }
    getTypeString() {
        if (this.getOpType() instanceof Type_1.UnionType || this.getOpType() instanceof Type_1.IntersectionType) {
            return `keyof (${this.getOpType().toString()})`;
        }
        return `keyof ${this.getOpType().toString()}`;
    }
    inferType(arkMethod) {
        IRInference_1.IRInference.inferKeyofTypeExpr(this, arkMethod);
    }
}
exports.KeyofTypeExpr = KeyofTypeExpr;
//# sourceMappingURL=TypeExpr.js.map