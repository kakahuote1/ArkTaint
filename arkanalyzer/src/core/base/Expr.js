"use strict";
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
exports.AliasTypeExpr = exports.ArkUnopExpr = exports.UnaryOperator = exports.ArkPhiExpr = exports.ArkCastExpr = exports.ArkInstanceOfExpr = exports.ArkTypeOfExpr = exports.ArkNormalBinopExpr = exports.ArkConditionExpr = exports.AbstractBinopExpr = exports.RelationalBinaryOperator = exports.NormalBinaryOperator = exports.ArkYieldExpr = exports.ArkAwaitExpr = exports.ArkDeleteExpr = exports.ArkNewArrayExpr = exports.ArkNewExpr = exports.ArkPtrInvokeExpr = exports.ArkStaticInvokeExpr = exports.ArkInstanceInvokeExpr = exports.AbstractInvokeExpr = exports.AbstractExpr = void 0;
const TypeInference_1 = require("../common/TypeInference");
const Local_1 = require("./Local");
const Type_1 = require("./Type");
const Ref_1 = require("./Ref");
const ValueUtil_1 = require("../common/ValueUtil");
const ArkMethod_1 = require("../model/ArkMethod");
const Const_1 = require("../common/Const");
const IRInference_1 = require("../common/IRInference");
const ArkImport_1 = require("../model/ArkImport");
const ArkClass_1 = require("../model/ArkClass");
const ArkField_1 = require("../model/ArkField");
const ModelUtils_1 = require("../common/ModelUtils");
/**
 * @category core/base/expr
 */
class AbstractExpr {
    inferType(arkMethod) {
        return this;
    }
}
exports.AbstractExpr = AbstractExpr;
class AbstractInvokeExpr extends AbstractExpr {
    constructor(methodSignature, args, realGenericTypes, spreadFlags) {
        super();
        this.methodSignature = methodSignature;
        this.args = args;
        this.realGenericTypes = realGenericTypes;
        this.spreadFlags = spreadFlags;
    }
    /**
     * Get method Signature. The method signature is consist of ClassSignature and MethodSubSignature.
     * It is the unique flag of a method. It is usually used to compose a expression string in ArkIRTransformer.
     * @returns The class method signature, such as ArkStaticInvokeExpr.
     * @example
     * 1. 3AC information composed of getMethodSignature ().

     ```typescript
     let strs: string[] = [];
     strs.push('staticinvoke <');
     strs.push(this.getMethodSignature().toString());
     strs.push('>(');
     ```
     */
    getMethodSignature() {
        return this.methodSignature;
    }
    setMethodSignature(newMethodSignature) {
        this.methodSignature = newMethodSignature;
    }
    /**
     * Returns an argument used in the expression according to its index.
     * @param index - the index of the argument.
     * @returns An argument used in the expression.
     */
    getArg(index) {
        return this.args[index];
    }
    /**
     * Returns an **array** of arguments used in the expression.
     * @returns An **array** of arguments used in the expression.
     * @example
     * 1. get args number.

     ```typescript
     const argsNum = expr.getArgs().length;
     if (argsNum < 5) {
     ... ...
     }
     ```

     2. iterate arg based on expression

     ```typescript
     for (const arg of this.getArgs()) {
     strs.push(arg.toString());
     strs.push(', ');
     }
     ```
     */
    getArgs() {
        return this.args;
    }
    setArgs(newArgs) {
        this.args = newArgs;
    }
    getType() {
        const type = this.methodSignature.getType();
        if (TypeInference_1.TypeInference.checkType(type, t => t instanceof Type_1.GenericType || t instanceof Type_1.AnyType) &&
            this.realGenericTypes) {
            return TypeInference_1.TypeInference.replaceTypeWithReal(type, this.realGenericTypes);
        }
        return type;
    }
    getRealGenericTypes() {
        return this.realGenericTypes;
    }
    setRealGenericTypes(realTypes) {
        if (realTypes) {
            this.realGenericTypes = realTypes;
        }
    }
    getSpreadFlags() {
        return this.spreadFlags;
    }
    getUses() {
        let uses = [];
        uses.push(...this.args);
        for (const arg of this.args) {
            uses.push(...arg.getUses());
        }
        return uses;
    }
    argsToString() {
        const strs = [];
        strs.push('(');
        if (this.getArgs().length > 0) {
            for (let i = 0; i < this.getArgs().length; i++) {
                if (this.spreadFlags && this.spreadFlags[i]) {
                    strs.push('...');
                }
                strs.push(this.getArgs()[i].toString());
                strs.push(', ');
            }
            strs.pop();
        }
        strs.push(')');
        return strs.join('');
    }
}
exports.AbstractInvokeExpr = AbstractInvokeExpr;
class ArkInstanceInvokeExpr extends AbstractInvokeExpr {
    constructor(base, methodSignature, args, realGenericTypes, spreadFlags) {
        super(methodSignature, args, realGenericTypes, spreadFlags);
        this.base = base;
    }
    /**
     * Returns the local of the instance of invoke expression.
     * @returns The local of the invoke expression's instance..
     */
    getBase() {
        return this.base;
    }
    setBase(newBase) {
        this.base = newBase;
    }
    /**
     * Returns an **array** of values used in this invoke expression,
     * including all arguments and values each arguments used.
     * For {@link ArkInstanceInvokeExpr}, the return also contains the caller base and uses of base.
     * @returns An **array** of arguments used in the invoke expression.
     */
    getUses() {
        let uses = [];
        uses.push(this.base);
        uses.push(...this.base.getUses());
        uses.push(...this.getArgs());
        for (const arg of this.getArgs()) {
            uses.push(...arg.getUses());
        }
        return uses;
    }
    toString() {
        let strs = [];
        strs.push('instanceinvoke ');
        strs.push(this.base.toString());
        strs.push('.<');
        strs.push(this.getMethodSignature().toString());
        strs.push('>');
        strs.push(super.argsToString());
        return strs.join('');
    }
    inferType(arkMethod) {
        return IRInference_1.IRInference.inferInstanceInvokeExpr(this, arkMethod);
    }
}
exports.ArkInstanceInvokeExpr = ArkInstanceInvokeExpr;
class ArkStaticInvokeExpr extends AbstractInvokeExpr {
    constructor(methodSignature, args, realGenericTypes, spreadFlags) {
        super(methodSignature, args, realGenericTypes, spreadFlags);
    }
    toString() {
        let strs = [];
        strs.push('staticinvoke <');
        strs.push(this.getMethodSignature().toString());
        strs.push('>');
        strs.push(super.argsToString());
        return strs.join('');
    }
    inferType(arkMethod) {
        return IRInference_1.IRInference.inferStaticInvokeExpr(this, arkMethod);
    }
}
exports.ArkStaticInvokeExpr = ArkStaticInvokeExpr;
/**
 *     1. Local PtrInvokeExpr
 *
 *      ```typescript
 *      func foo():void {
 *      }
 *      let ptr = foo;
 *      ptr();
 *      ```
 *     2. FieldRef PtrInvokeExpr
 *
 *      ```typescript
 *      class A {
 *          b:()=> void()
 *      }
 *      new A().b()
 *      ```
 */
class ArkPtrInvokeExpr extends AbstractInvokeExpr {
    constructor(methodSignature, ptr, args, realGenericTypes, spreadFlags) {
        super(methodSignature, args, realGenericTypes, spreadFlags);
        this.funPtr = ptr;
    }
    setFunPtrLocal(ptr) {
        this.funPtr = ptr;
    }
    getFuncPtrLocal() {
        return this.funPtr;
    }
    inferType(arkMethod) {
        this.getArgs().forEach(arg => TypeInference_1.TypeInference.inferValueType(arg, arkMethod));
        const ptrType = this.funPtr.getType();
        if (ptrType instanceof Type_1.FunctionType) {
            this.setMethodSignature(ptrType.getMethodSignature());
        }
        IRInference_1.IRInference.inferArgs(this, arkMethod);
        return IRInference_1.IRInference.inferStaticInvokeExpr(this, arkMethod);
    }
    toString() {
        let strs = [];
        strs.push('ptrinvoke ');
        let ptrName = '';
        if (this.funPtr instanceof Local_1.Local) {
            ptrName = this.funPtr.getName();
        }
        else if (this.funPtr instanceof Ref_1.ArkInstanceFieldRef) {
            ptrName = this.funPtr.getBase().getName() + '.' + this.funPtr.getFieldName();
        }
        else if (this.funPtr instanceof Ref_1.ArkStaticFieldRef) {
            ptrName = this.funPtr.getFieldName();
        }
        strs.push(ptrName);
        strs.push('<');
        strs.push(this.getMethodSignature().toString());
        strs.push('>');
        strs.push(super.argsToString());
        return strs.join('');
    }
    getUses() {
        let uses = [];
        uses.push(this.getFuncPtrLocal());
        uses.push(...this.getArgs());
        for (const arg of this.getArgs()) {
            uses.push(...arg.getUses());
        }
        return uses;
    }
}
exports.ArkPtrInvokeExpr = ArkPtrInvokeExpr;
class ArkNewExpr extends AbstractExpr {
    constructor(classType) {
        super();
        this.classType = classType;
    }
    getClassType() {
        return this.classType;
    }
    getUses() {
        return [];
    }
    getType() {
        return this.classType;
    }
    toString() {
        return 'new ' + this.classType;
    }
    inferType(arkMethod) {
        const classSignature = this.classType.getClassSignature();
        if (classSignature.getDeclaringFileSignature().getFileName() === Const_1.UNKNOWN_FILE_NAME) {
            const className = classSignature.getClassName();
            let type = ModelUtils_1.ModelUtils.findDeclaredLocal(new Local_1.Local(className), arkMethod, 1)?.getType();
            if (TypeInference_1.TypeInference.isUnclearType(type)) {
                type = TypeInference_1.TypeInference.inferUnclearRefName(className, arkMethod.getDeclaringArkClass());
            }
            if (type instanceof Type_1.AliasType) {
                const originalType = TypeInference_1.TypeInference.replaceAliasType(type);
                if (originalType instanceof Type_1.FunctionType) {
                    type = originalType.getMethodSignature().getMethodSubSignature().getReturnType();
                }
                else {
                    type = originalType;
                }
            }
            if (type && type instanceof Type_1.ClassType) {
                const instanceType = this.constructorSignature(type, arkMethod) ?? type;
                this.classType.setClassSignature(instanceType.getClassSignature());
                TypeInference_1.TypeInference.inferRealGenericTypes(this.classType.getRealGenericTypes(), arkMethod.getDeclaringArkClass());
            }
        }
        return this;
    }
    constructorSignature(type, arkMethod) {
        const classConstructor = arkMethod.getDeclaringArkFile().getScene().getClass(type.getClassSignature());
        if (classConstructor?.getCategory() === ArkClass_1.ClassCategory.INTERFACE) {
            const type = classConstructor.getMethodWithName('construct-signature')?.getReturnType();
            if (type) {
                const returnType = TypeInference_1.TypeInference.replaceAliasType(type);
                return returnType instanceof Type_1.ClassType ? returnType : undefined;
            }
        }
        return undefined;
    }
}
exports.ArkNewExpr = ArkNewExpr;
class ArkNewArrayExpr extends AbstractExpr {
    constructor(baseType, size, fromLiteral = false) {
        super();
        this.baseType = baseType;
        this.size = size;
        this.fromLiteral = fromLiteral;
    }
    getSize() {
        return this.size;
    }
    setSize(newSize) {
        this.size = newSize;
    }
    getType() {
        return new Type_1.ArrayType(this.baseType, 1);
    }
    getBaseType() {
        return this.baseType;
    }
    setBaseType(newType) {
        this.baseType = newType;
    }
    isFromLiteral() {
        return this.fromLiteral;
    }
    inferType(arkMethod) {
        const type = TypeInference_1.TypeInference.inferUnclearedType(this.baseType, arkMethod.getDeclaringArkClass());
        if (type) {
            this.baseType = type;
        }
        return this;
    }
    getUses() {
        let uses = [this.size];
        uses.push(...this.size.getUses());
        return uses;
    }
    toString() {
        return 'newarray (' + this.baseType + ')[' + this.size + ']';
    }
}
exports.ArkNewArrayExpr = ArkNewArrayExpr;
class ArkDeleteExpr extends AbstractExpr {
    constructor(field) {
        super();
        this.field = field;
    }
    getField() {
        return this.field;
    }
    setField(newField) {
        this.field = newField;
    }
    getType() {
        return Type_1.BooleanType.getInstance();
    }
    getUses() {
        const uses = [];
        uses.push(this.field);
        uses.push(...this.field.getUses());
        return uses;
    }
    toString() {
        return 'delete ' + this.field;
    }
}
exports.ArkDeleteExpr = ArkDeleteExpr;
class ArkAwaitExpr extends AbstractExpr {
    constructor(promise) {
        super();
        this.promise = promise;
    }
    getPromise() {
        return this.promise;
    }
    setPromise(newPromise) {
        this.promise = newPromise;
    }
    getType() {
        const type = this.promise.getType();
        if (type instanceof Type_1.UnclearReferenceType) {
            return type.getGenericTypes()[0];
        }
        else if (type instanceof Type_1.ClassType) {
            return type.getRealGenericTypes()?.[0] ?? type;
        }
        return type;
    }
    inferType(arkMethod) {
        TypeInference_1.TypeInference.inferValueType(this.promise, arkMethod);
        return this;
    }
    getUses() {
        const uses = [];
        uses.push(this.promise);
        uses.push(...this.promise.getUses());
        return uses;
    }
    toString() {
        const str = 'await ' + this.promise;
        return str;
    }
}
exports.ArkAwaitExpr = ArkAwaitExpr;
class ArkYieldExpr extends AbstractExpr {
    constructor(yieldValue) {
        super();
        this.yieldValue = yieldValue;
    }
    getYieldValue() {
        return this.yieldValue;
    }
    setYieldValue(newYieldValue) {
        this.yieldValue = newYieldValue;
    }
    getType() {
        return this.yieldValue.getType();
    }
    getUses() {
        const uses = [];
        uses.push(this.yieldValue);
        uses.push(...this.yieldValue.getUses());
        return uses;
    }
    toString() {
        const str = 'yield ' + this.yieldValue;
        return str;
    }
}
exports.ArkYieldExpr = ArkYieldExpr;
var NormalBinaryOperator;
(function (NormalBinaryOperator) {
    // TODO: unfold it
    NormalBinaryOperator["NullishCoalescing"] = "??";
    // arithmetic
    NormalBinaryOperator["Exponentiation"] = "**";
    NormalBinaryOperator["Division"] = "/";
    NormalBinaryOperator["Addition"] = "+";
    NormalBinaryOperator["Subtraction"] = "-";
    NormalBinaryOperator["Multiplication"] = "*";
    NormalBinaryOperator["Remainder"] = "%";
    // shift
    NormalBinaryOperator["LeftShift"] = "<<";
    NormalBinaryOperator["RightShift"] = ">>";
    NormalBinaryOperator["UnsignedRightShift"] = ">>>";
    // Bitwise
    NormalBinaryOperator["BitwiseAnd"] = "&";
    NormalBinaryOperator["BitwiseOr"] = "|";
    NormalBinaryOperator["BitwiseXor"] = "^";
    // Logical
    NormalBinaryOperator["LogicalAnd"] = "&&";
    NormalBinaryOperator["LogicalOr"] = "||";
})(NormalBinaryOperator || (exports.NormalBinaryOperator = NormalBinaryOperator = {}));
var RelationalBinaryOperator;
(function (RelationalBinaryOperator) {
    RelationalBinaryOperator["LessThan"] = "<";
    RelationalBinaryOperator["LessThanOrEqual"] = "<=";
    RelationalBinaryOperator["GreaterThan"] = ">";
    RelationalBinaryOperator["GreaterThanOrEqual"] = ">=";
    RelationalBinaryOperator["Equality"] = "==";
    RelationalBinaryOperator["InEquality"] = "!=";
    RelationalBinaryOperator["StrictEquality"] = "===";
    RelationalBinaryOperator["StrictInequality"] = "!==";
    RelationalBinaryOperator["isPropertyOf"] = "in";
})(RelationalBinaryOperator || (exports.RelationalBinaryOperator = RelationalBinaryOperator = {}));
// 二元运算表达式
class AbstractBinopExpr extends AbstractExpr {
    constructor(op1, op2, operator) {
        super();
        this.op1 = op1;
        this.op2 = op2;
        this.operator = operator;
    }
    /**
     * Returns the first operand in the binary operation expression.
     * For example, the first operand in `a + b;` is `a`.
     * @returns The first operand in the binary operation expression.
     */
    getOp1() {
        return this.op1;
    }
    setOp1(newOp1) {
        this.op1 = newOp1;
    }
    /**
     * Returns the second operand in the binary operation expression.
     * For example, the second operand in `a + b;` is `b`.
     * @returns The second operand in the binary operation expression.
     */
    getOp2() {
        return this.op2;
    }
    setOp2(newOp2) {
        this.op2 = newOp2;
    }
    /**
     * Get the binary operator from the statement.
     * The binary operator can be divided into two categories,
     * one is the normal binary operator and the other is relational binary operator.
     * @returns The binary operator from the statement.
     * @example
     ```typescript
     if (expr instanceof AbstractBinopExpr) {
     let op1: Value = expr.getOp1();
     let op2: Value = expr.getOp2();
     let operator: string = expr.getOperator();
     ... ...
     }
     ```
     */
    getOperator() {
        return this.operator;
    }
    getType() {
        if (!this.type) {
            this.setType();
        }
        return this.type;
    }
    getUses() {
        let uses = [];
        uses.push(this.op1);
        uses.push(...this.op1.getUses());
        uses.push(this.op2);
        uses.push(...this.op2.getUses());
        return uses;
    }
    toString() {
        return this.op1 + ' ' + this.operator + ' ' + this.op2;
    }
    inferOpType(op, arkMethod) {
        TypeInference_1.TypeInference.inferValueType(op, arkMethod);
    }
    parseType(op) {
        if (op instanceof Type_1.UnionType) {
            return op.getCurrType();
        }
        else if (op instanceof Type_1.EnumValueType) {
            return op.getConstant()?.getType() || op;
        }
        return op;
    }
    setType() {
        let op1Type = this.parseType(this.op1.getType());
        let op2Type = this.parseType(this.op2.getType());
        let type = Type_1.UnknownType.getInstance();
        switch (this.operator) {
            case '+':
                if (op1Type === Type_1.StringType.getInstance() || op2Type === Type_1.StringType.getInstance()) {
                    type = Type_1.StringType.getInstance();
                }
                if (op1Type === Type_1.NumberType.getInstance() && op2Type === Type_1.NumberType.getInstance()) {
                    type = Type_1.NumberType.getInstance();
                }
                if (op1Type === Type_1.BigIntType.getInstance() && op2Type === Type_1.BigIntType.getInstance()) {
                    type = Type_1.BigIntType.getInstance();
                }
                break;
            case '-':
            case '*':
            case '/':
            case '%':
            case '**':
                if (op1Type === Type_1.BigIntType.getInstance() || op2Type === Type_1.BigIntType.getInstance()) {
                    type = Type_1.BigIntType.getInstance();
                }
                else {
                    type = Type_1.NumberType.getInstance();
                }
                break;
            case '!=':
            case '!==':
            case '<':
            case '>':
            case '<=':
            case '>=':
            case '&&':
            case '||':
            case '==':
            case '===':
            case 'in':
                type = Type_1.BooleanType.getInstance();
                break;
            case '&':
            case '|':
            case '^':
            case '<<':
            case '>>':
                if (op1Type === Type_1.NumberType.getInstance() && op2Type === Type_1.NumberType.getInstance()) {
                    type = Type_1.NumberType.getInstance();
                }
                if (op1Type === Type_1.BigIntType.getInstance() && op2Type === Type_1.BigIntType.getInstance()) {
                    type = Type_1.BigIntType.getInstance();
                }
                break;
            case '>>>':
                if (op1Type === Type_1.NumberType.getInstance() && op2Type === Type_1.NumberType.getInstance()) {
                    type = Type_1.NumberType.getInstance();
                }
                break;
            case '??':
                if (op1Type === Type_1.UnknownType.getInstance() || op1Type === Type_1.UndefinedType.getInstance() || op1Type === Type_1.NullType.getInstance()) {
                    type = op2Type;
                }
                else {
                    type = op1Type;
                }
                break;
            default:
        }
        this.type = type;
    }
    inferType(arkMethod) {
        this.inferOpType(this.op1, arkMethod);
        this.inferOpType(this.op2, arkMethod);
        this.setType();
        return this;
    }
}
exports.AbstractBinopExpr = AbstractBinopExpr;
class ArkConditionExpr extends AbstractBinopExpr {
    constructor(op1, op2, operator) {
        super(op1, op2, operator);
    }
    inferType(arkMethod) {
        this.inferOpType(this.op1, arkMethod);
        const op1Type = this.op1.getType();
        if (this.operator === RelationalBinaryOperator.InEquality && this.op2 === ValueUtil_1.ValueUtil.getOrCreateNumberConst(0)) {
            if (op1Type instanceof Type_1.StringType) {
                this.op2 = ValueUtil_1.ValueUtil.createStringConst(ValueUtil_1.EMPTY_STRING);
            }
            else if (op1Type instanceof Type_1.BooleanType) {
                this.op2 = ValueUtil_1.ValueUtil.getBooleanConstant(false);
            }
            else if (op1Type instanceof Type_1.ClassType) {
                this.op2 = ValueUtil_1.ValueUtil.getUndefinedConst();
            }
        }
        else {
            this.inferOpType(this.getOp2(), arkMethod);
        }
        this.type = Type_1.BooleanType.getInstance();
        return this;
    }
    fillType() {
        this.type = Type_1.BooleanType.getInstance();
    }
}
exports.ArkConditionExpr = ArkConditionExpr;
class ArkNormalBinopExpr extends AbstractBinopExpr {
    constructor(op1, op2, operator) {
        super(op1, op2, operator);
    }
}
exports.ArkNormalBinopExpr = ArkNormalBinopExpr;
class ArkTypeOfExpr extends AbstractExpr {
    constructor(op) {
        super();
        this.op = op;
    }
    getOp() {
        return this.op;
    }
    setOp(newOp) {
        this.op = newOp;
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
    getType() {
        return this.op.getType();
    }
    toString() {
        return 'typeof ' + this.op;
    }
    inferType(arkMethod) {
        if (this.op instanceof Ref_1.AbstractRef || this.op instanceof AbstractExpr) {
            this.op.inferType(arkMethod);
        }
        return this;
    }
}
exports.ArkTypeOfExpr = ArkTypeOfExpr;
class ArkInstanceOfExpr extends AbstractExpr {
    constructor(op, checkType) {
        super();
        this.op = op;
        this.checkType = checkType;
    }
    getOp() {
        return this.op;
    }
    setOp(newOp) {
        this.op = newOp;
    }
    getCheckType() {
        return this.checkType;
    }
    setCheckType(type) {
        this.checkType = type;
    }
    getType() {
        return Type_1.BooleanType.getInstance();
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
    toString() {
        return this.op + ' instanceof ' + this.checkType;
    }
    inferType(arkMethod) {
        TypeInference_1.TypeInference.inferValueType(this.op, arkMethod);
        if (TypeInference_1.TypeInference.isUnclearType(this.checkType)) {
            const newType = TypeInference_1.TypeInference.inferUnclearedType(this.checkType, arkMethod.getDeclaringArkClass());
            if (newType) {
                this.checkType = newType;
            }
        }
        return this;
    }
}
exports.ArkInstanceOfExpr = ArkInstanceOfExpr;
// 类型转换
class ArkCastExpr extends AbstractExpr {
    constructor(op, type) {
        super();
        this.op = op;
        this.type = type;
    }
    getOp() {
        return this.op;
    }
    setOp(newOp) {
        this.op = newOp;
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
    getType() {
        return this.type;
    }
    setType(type) {
        this.type = type;
    }
    inferType(arkMethod) {
        if (TypeInference_1.TypeInference.isUnclearType(this.getType())) {
            const type = TypeInference_1.TypeInference.inferUnclearedType(this.type, arkMethod.getDeclaringArkClass()) ?? this.op.getType();
            if (type !== undefined && !TypeInference_1.TypeInference.isUnclearType(type)) {
                this.type = type;
                IRInference_1.IRInference.inferRightWithSdkType(type, this.op.getType(), arkMethod.getDeclaringArkClass());
            }
        }
        return this;
    }
    toString() {
        return '<' + this.type + '>' + this.op;
    }
}
exports.ArkCastExpr = ArkCastExpr;
class ArkPhiExpr extends AbstractExpr {
    constructor() {
        super();
        this.args = [];
        this.argToBlock = new Map();
    }
    getUses() {
        let uses = [];
        uses.push(...this.args);
        return uses;
    }
    getArgs() {
        return this.args;
    }
    setArgs(args) {
        this.args = args;
    }
    getArgToBlock() {
        return this.argToBlock;
    }
    setArgToBlock(argToBlock) {
        this.argToBlock = argToBlock;
    }
    getType() {
        return this.args[0].getType();
    }
    toString() {
        let strs = [];
        strs.push('phi(');
        if (this.args.length > 0) {
            for (const arg of this.args) {
                strs.push(arg.toString());
                strs.push(', ');
            }
            strs.pop();
        }
        strs.push(')');
        return strs.join('');
    }
}
exports.ArkPhiExpr = ArkPhiExpr;
var UnaryOperator;
(function (UnaryOperator) {
    UnaryOperator["Neg"] = "-";
    UnaryOperator["BitwiseNot"] = "~";
    UnaryOperator["LogicalNot"] = "!";
})(UnaryOperator || (exports.UnaryOperator = UnaryOperator = {}));
// unary operation expression
class ArkUnopExpr extends AbstractExpr {
    constructor(op, operator) {
        super();
        this.op = op;
        this.operator = operator;
    }
    getUses() {
        let uses = [];
        uses.push(this.op);
        uses.push(...this.op.getUses());
        return uses;
    }
    getOp() {
        return this.op;
    }
    setOp(newOp) {
        this.op = newOp;
    }
    getType() {
        return this.op.getType();
    }
    /**
     * Get the unary operator from the statement, such as `-`,`~`,`!`.
     * @returns the unary operator of a statement.
     */
    getOperator() {
        return this.operator;
    }
    toString() {
        return this.operator + this.op;
    }
}
exports.ArkUnopExpr = ArkUnopExpr;
/**
 * Expression of the right hand of the type alias definition statement.
 * @category core/base/expr
 * @extends AbstractExpr
 * @example
 ```typescript
 let a: number = 123;
 type ABC = typeof a;
 ```
 * The AliasTypeExpr of the previous statement is with local 'a' as the 'originalObject' and 'transferWithTypeOf' is true.
 *
 * The Following case: import type with no clause name is not supported now,
 * whose 'originalObject' is {@link ImportInfo} with 'null' 'lazyExportInfo'.
 ```typescript
 let a = typeof import('./abc');
 ```
 */
class AliasTypeExpr extends AbstractExpr {
    constructor(originalObject, transferWithTypeOf) {
        super();
        this.transferWithTypeOf = false;
        this.originalObject = originalObject;
        if (transferWithTypeOf !== undefined) {
            this.transferWithTypeOf = transferWithTypeOf;
        }
    }
    getOriginalObject() {
        return this.originalObject;
    }
    setOriginalObject(object) {
        this.originalObject = object;
    }
    getTransferWithTypeOf() {
        return this.transferWithTypeOf;
    }
    setRealGenericTypes(realGenericTypes) {
        this.realGenericTypes = realGenericTypes;
    }
    getRealGenericTypes() {
        return this.realGenericTypes;
    }
    getOriginalType() {
        return this.originalType;
    }
    setOriginalType(type) {
        return this.originalType = type;
    }
    getType() {
        function getTypeOfImportInfo(importInfo) {
            const arkExport = importInfo.getLazyExportInfo()?.getArkExport();
            const importClauseName = importInfo.getImportClauseName();
            let type;
            if (importClauseName.includes('.') && arkExport instanceof ArkClass_1.ArkClass) {
                type = TypeInference_1.TypeInference.inferUnclearRefName(importClauseName, arkExport);
            }
            else if (arkExport) {
                type = TypeInference_1.TypeInference.parseArkExport2Type(arkExport);
            }
            return type ?? Type_1.UnknownType.getInstance();
        }
        const operator = this.getOriginalObject();
        if (!this.getTransferWithTypeOf()) {
            if (operator instanceof Type_1.Type) {
                return TypeInference_1.TypeInference.replaceTypeWithReal(operator, this.getRealGenericTypes());
            }
            if (operator instanceof ArkImport_1.ImportInfo) {
                return getTypeOfImportInfo(operator);
            }
            if (operator instanceof ArkClass_1.ArkClass) {
                return TypeInference_1.TypeInference.replaceTypeWithReal(new Type_1.ClassType(operator.getSignature(), operator.getGenericsTypes()), this.getRealGenericTypes());
            }
            return Type_1.UnknownType.getInstance();
        }
        if (operator instanceof ArkImport_1.ImportInfo) {
            return getTypeOfImportInfo(operator);
        }
        if (operator instanceof Local_1.Local || operator instanceof ArkField_1.ArkField) {
            return operator.getType();
        }
        if (operator instanceof ArkClass_1.ArkClass) {
            return TypeInference_1.TypeInference.replaceTypeWithReal(new Type_1.ClassType(operator.getSignature(), operator.getGenericsTypes()), this.getRealGenericTypes());
        }
        if (operator instanceof ArkMethod_1.ArkMethod) {
            return TypeInference_1.TypeInference.replaceTypeWithReal(new Type_1.FunctionType(operator.getSignature(), operator.getGenericTypes()), this.getRealGenericTypes());
        }
        return Type_1.UnknownType.getInstance();
    }
    inferType(arkMethod) {
        return IRInference_1.IRInference.inferAliasTypeExpr(this, arkMethod);
    }
    /**
     * Returns all used values which mainly used for def-use chain analysis.
     * @returns Always returns empty array because her is the alias type definition which has no relationship with value flow.
     */
    getUses() {
        if (this.originalObject instanceof Local_1.Local) {
            return [this.originalObject];
        }
        return [];
    }
    toString() {
        let typeOf = '';
        if (this.getTransferWithTypeOf()) {
            typeOf = 'typeof ';
        }
        const typeObject = this.getOriginalObject();
        if (typeObject instanceof Type_1.AliasType && this.getRealGenericTypes()) {
            return `${typeOf}${typeObject.getSignature().toString()}<${this.getRealGenericTypes().join(',')}>`;
        }
        if (typeObject instanceof Type_1.Type) {
            return `${typeOf}${typeObject.getTypeString()}`;
        }
        if (typeObject instanceof ArkImport_1.ImportInfo) {
            let res = `${typeOf}import('${typeObject.getFrom()}')`;
            if (typeObject.getImportClauseName() !== '') {
                res = `${res}.${typeObject.getImportClauseName()}`;
            }
            return res;
        }
        if (typeObject instanceof Local_1.Local) {
            return `${typeOf}${typeObject.toString()}`;
        }
        if (typeObject instanceof ArkClass_1.ArkClass || typeObject instanceof ArkMethod_1.ArkMethod) {
            let res = `${typeOf}${typeObject.getSignature().toString()}`;
            if (this.getRealGenericTypes() && typeObject instanceof ArkClass_1.ArkClass) {
                res += `<${this.getRealGenericTypes().join(',')}>`;
            }
            else if (this.getRealGenericTypes() && typeObject instanceof ArkMethod_1.ArkMethod) {
                const genericTypes = this.getRealGenericTypes().join(',');
                res = res.replace('(', `<${genericTypes}>(`).replace(/\([^)]*\)/g, `(${genericTypes})`);
            }
            return res;
        }
        return `${typeOf}${typeObject.getName()}`;
    }
    static isAliasTypeOriginalModel(object) {
        return (object instanceof Type_1.Type ||
            object instanceof ArkImport_1.ImportInfo ||
            object instanceof Local_1.Local ||
            object instanceof ArkClass_1.ArkClass ||
            object instanceof ArkMethod_1.ArkMethod ||
            object instanceof ArkField_1.ArkField);
    }
}
exports.AliasTypeExpr = AliasTypeExpr;
//# sourceMappingURL=Expr.js.map