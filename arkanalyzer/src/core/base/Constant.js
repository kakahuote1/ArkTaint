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
exports.UndefinedConstant = exports.NullConstant = exports.StringConstant = exports.BigIntConstant = exports.NumberConstant = exports.BooleanConstant = exports.Constant = void 0;
const Type_1 = require("./Type");
const TSConst_1 = require("../common/TSConst");
/**
 * @category core/base
 */
class Constant {
    constructor(value, type) {
        this.value = value;
        this.type = type;
    }
    /**
     * Returns the constant's value as a **string**.
     * @returns The constant's value.
     */
    getValue() {
        return this.value;
    }
    getUses() {
        return [];
    }
    /**
     * Returns the type of this constant.
     * @returns The type of this constant.
     */
    getType() {
        return this.type;
    }
    /**
     * Get a string of constant value in Constant.
     * @returns The string of constant value.
     */
    toString() {
        let str = '';
        if (this.type instanceof Type_1.StringType) {
            str = "'" + this.value + "'";
        }
        else {
            str = this.value;
        }
        return str;
    }
}
exports.Constant = Constant;
class BooleanConstant extends Constant {
    constructor(value) {
        super(value.toString(), Type_1.BooleanType.getInstance());
    }
    static getInstance(value) {
        return value ? this.TRUE : this.FALSE;
    }
}
exports.BooleanConstant = BooleanConstant;
BooleanConstant.FALSE = new BooleanConstant(false);
BooleanConstant.TRUE = new BooleanConstant(true);
class NumberConstant extends Constant {
    constructor(value) {
        super(value, Type_1.NumberType.getInstance());
    }
}
exports.NumberConstant = NumberConstant;
class BigIntConstant extends Constant {
    constructor(value) {
        super(value.toString() + 'n', Type_1.BigIntType.getInstance());
    }
}
exports.BigIntConstant = BigIntConstant;
class StringConstant extends Constant {
    constructor(value) {
        super(value.toString(), Type_1.StringType.getInstance());
    }
}
exports.StringConstant = StringConstant;
class NullConstant extends Constant {
    constructor() {
        super(TSConst_1.NULL_KEYWORD, Type_1.NullType.getInstance());
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.NullConstant = NullConstant;
NullConstant.INSTANCE = new NullConstant();
class UndefinedConstant extends Constant {
    constructor() {
        super(TSConst_1.UNDEFINED_KEYWORD, Type_1.UndefinedType.getInstance());
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.UndefinedConstant = UndefinedConstant;
UndefinedConstant.INSTANCE = new UndefinedConstant();
//# sourceMappingURL=Constant.js.map