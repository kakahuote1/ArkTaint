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
exports.serializeStmt = exports.serializeValue = exports.serializeConstant = exports.serializeLocal = exports.serializeBasicBlock = exports.serializeCfg = exports.serializeAliasTypeSignature = exports.serializeMethodSignature = exports.serializeFieldSignature = exports.serializeClassSignature = exports.serializeNamespaceSignature = exports.serializeFileSignature = exports.serializeType = exports.serializeLineColPosition = exports.serializeDecorator = exports.serializeExportInfo = exports.serializeImportInfo = exports.serializeMethodParameter = exports.serializeMethodBody = exports.serializeMethod = exports.serializeField = exports.serializeClass = exports.serializeNamespace = exports.serializeArkFile = exports.serializeArkScene = void 0;
const __1 = require("../..");
const JsonDto_1 = require("./JsonDto");
function serializeArkScene(scene) {
    return {
        files: scene.getFiles().map(f => serializeArkFile(f)),
        sdkFiles: scene.getSdkArkFiles().map(f => serializeArkFile(f)),
    };
}
exports.serializeArkScene = serializeArkScene;
function serializeArkFile(file) {
    return {
        signature: serializeFileSignature(file.getFileSignature()),
        namespaces: file.getNamespaces().map(ns => serializeNamespace(ns)),
        classes: file.getClasses().map(cls => serializeClass(cls)),
        importInfos: file.getImportInfos().map(info => serializeImportInfo(info)),
        exportInfos: file.getExportInfos().map(info => serializeExportInfo(info)),
    };
}
exports.serializeArkFile = serializeArkFile;
function serializeNamespace(namespace) {
    return {
        signature: serializeNamespaceSignature(namespace.getSignature()),
        classes: namespace.getClasses().map(cls => serializeClass(cls)),
        namespaces: namespace.getNamespaces().map(ns => serializeNamespace(ns)),
    };
}
exports.serializeNamespace = serializeNamespace;
function serializeClass(clazz) {
    var _a;
    return {
        signature: serializeClassSignature(clazz.getSignature()),
        modifiers: clazz.getModifiers(),
        decorators: clazz.getDecorators().map(decorator => serializeDecorator(decorator)),
        typeParameters: (_a = clazz.getGenericsTypes()) === null || _a === void 0 ? void 0 : _a.map(type => serializeType(type)),
        category: clazz.getCategory(),
        superClassName: clazz.getSuperClassName(),
        implementedInterfaceNames: clazz.getImplementedInterfaceNames(),
        fields: clazz.getFields().map(field => serializeField(field)),
        methods: clazz.getMethods(true).map(method => serializeMethod(method)),
    };
}
exports.serializeClass = serializeClass;
function serializeField(field) {
    return {
        signature: serializeFieldSignature(field.getSignature()),
        modifiers: field.getModifiers(),
        decorators: field.getDecorators().map(decorator => serializeDecorator(decorator)),
        questionToken: field.getQuestionToken(),
        exclamationToken: field.getExclamationToken(),
    };
}
exports.serializeField = serializeField;
function serializeMethod(method) {
    var _a;
    const body = method.getBody();
    return {
        signature: serializeMethodSignature(method.getSignature()),
        modifiers: method.getModifiers(),
        decorators: method.getDecorators().map(decorator => serializeDecorator(decorator)),
        typeParameters: (_a = method.getGenericTypes()) === null || _a === void 0 ? void 0 : _a.map(type => serializeType(type)),
        body: body && serializeMethodBody(body),
    };
}
exports.serializeMethod = serializeMethod;
function serializeMethodBody(body) {
    return {
        locals: Array.from(body.getLocals().values()).map(local => serializeLocal(local)),
        cfg: serializeCfg(body.getCfg()),
    };
}
exports.serializeMethodBody = serializeMethodBody;
function serializeMethodParameter(parameter) {
    return {
        name: parameter.getName(),
        type: serializeType(parameter.getType()),
        isOptional: parameter.isOptional(),
        isRest: parameter.isRest(),
    };
}
exports.serializeMethodParameter = serializeMethodParameter;
function serializeImportInfo(importInfo) {
    return {
        importName: importInfo.getImportClauseName(),
        importType: importInfo.getImportType(),
        importFrom: importInfo.getFrom(),
        nameBeforeAs: importInfo.getNameBeforeAs(),
        modifiers: importInfo.getModifiers(),
    };
}
exports.serializeImportInfo = serializeImportInfo;
function serializeExportInfo(exportInfo) {
    return {
        exportName: exportInfo.getExportClauseName(),
        exportType: exportInfo.getExportClauseType(),
        exportFrom: exportInfo.getFrom(),
        nameBeforeAs: exportInfo.getNameBeforeAs(),
        modifiers: exportInfo.getModifiers(),
    };
}
exports.serializeExportInfo = serializeExportInfo;
function serializeDecorator(decorator) {
    return {
        kind: decorator.getKind(),
    };
}
exports.serializeDecorator = serializeDecorator;
function serializeLineColPosition(position) {
    return {
        line: position.getLineNo(),
        col: position.getColNo(),
    };
}
exports.serializeLineColPosition = serializeLineColPosition;
function serializeType(type) {
    var _a, _b, _c;
    if (type === undefined) {
        throw new Error('Type is undefined');
    }
    if (type instanceof __1.AnyType) {
        return (0, JsonDto_1.polymorphic)('AnyType', {});
    }
    else if (type instanceof __1.UnknownType) {
        return (0, JsonDto_1.polymorphic)('UnknownType', {});
    }
    else if (type instanceof __1.VoidType) {
        return (0, JsonDto_1.polymorphic)('VoidType', {});
    }
    else if (type instanceof __1.NeverType) {
        return (0, JsonDto_1.polymorphic)('NeverType', {});
    }
    else if (type instanceof __1.UnionType) {
        return (0, JsonDto_1.polymorphic)('UnionType', {
            types: type.getTypes().map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.IntersectionType) {
        return (0, JsonDto_1.polymorphic)('IntersectionType', {
            types: type.getTypes().map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.TupleType) {
        return (0, JsonDto_1.polymorphic)('TupleType', {
            types: type.getTypes().map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.BooleanType) {
        return (0, JsonDto_1.polymorphic)('BooleanType', {});
    }
    else if (type instanceof __1.NumberType) {
        return (0, JsonDto_1.polymorphic)('NumberType', {});
    }
    else if (type instanceof __1.BigIntType) {
        return (0, JsonDto_1.polymorphic)('BigIntType', {});
    }
    else if (type instanceof __1.StringType) {
        return (0, JsonDto_1.polymorphic)('StringType', {});
    }
    else if (type instanceof __1.NullType) {
        return (0, JsonDto_1.polymorphic)('NullType', {});
    }
    else if (type instanceof __1.UndefinedType) {
        return (0, JsonDto_1.polymorphic)('UndefinedType', {});
    }
    else if (type instanceof __1.LiteralType) {
        return (0, JsonDto_1.polymorphic)('LiteralType', {
            literal: type.getLiteralName(),
        });
    }
    else if (type instanceof __1.ClassType) {
        return (0, JsonDto_1.polymorphic)('ClassType', {
            signature: serializeClassSignature(type.getClassSignature()),
            typeParameters: (_a = type.getRealGenericTypes()) === null || _a === void 0 ? void 0 : _a.map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.FunctionType) {
        if (type.getMethodSignature().getMethodSubSignature().getReturnType() === type) {
            // Handle recursive function types.
            // This is a workaround for the issue where the function type refers to itself,
            // which can cause infinite recursion during serialization.
            // In this case, we return a simple FunctionType without a signature.
            console.warn('Detected recursive function type, replacing return type with UnknownType');
            const sig = type.getMethodSignature();
            const sub = sig.getMethodSubSignature();
            const sig2 = new __1.MethodSignature(sig.getDeclaringClassSignature(), new __1.MethodSubSignature(sub.getMethodName(), sub.getParameters(), __1.UnknownType.getInstance(), sub.isStatic()));
            return (0, JsonDto_1.polymorphic)('FunctionType', {
                signature: serializeMethodSignature(sig2),
                typeParameters: (_b = type.getRealGenericTypes()) === null || _b === void 0 ? void 0 : _b.map(type => serializeType(type)),
            });
        }
        return (0, JsonDto_1.polymorphic)('FunctionType', {
            signature: serializeMethodSignature(type.getMethodSignature()),
            typeParameters: (_c = type.getRealGenericTypes()) === null || _c === void 0 ? void 0 : _c.map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.ArrayType) {
        return (0, JsonDto_1.polymorphic)('ArrayType', {
            elementType: serializeType(type.getBaseType()),
            dimensions: type.getDimension(),
        });
    }
    else if (type instanceof __1.UnclearReferenceType) {
        return (0, JsonDto_1.polymorphic)('UnclearReferenceType', {
            name: type.getName(),
            typeParameters: type.getGenericTypes().map(type => serializeType(type)),
        });
    }
    else if (type instanceof __1.AliasType) {
        return (0, JsonDto_1.polymorphic)('AliasType', {
            name: type.getName(),
            originalType: serializeType(type.getOriginalType()),
            signature: serializeAliasTypeSignature(type.getSignature()),
        });
    }
    else if (type instanceof __1.GenericType) {
        const constraint = type.getConstraint();
        const defaultType = type.getDefaultType();
        return (0, JsonDto_1.polymorphic)('GenericType', {
            name: type.getName(),
            constraint: constraint && serializeType(constraint),
            defaultType: defaultType && serializeType(defaultType),
        });
    }
    else if (type instanceof __1.AnnotationNamespaceType) {
        return (0, JsonDto_1.polymorphic)('AnnotationNamespaceType', {
            originType: type.getOriginType(),
            namespaceSignature: serializeNamespaceSignature(type.getNamespaceSignature()),
        });
    }
    else if (type instanceof __1.AnnotationTypeQueryType) {
        return (0, JsonDto_1.polymorphic)('AnnotationTypeQueryType', {
            originType: type.getOriginType(),
        });
    }
    else if (type instanceof __1.LexicalEnvType) {
        const m = type.getNestedMethod();
        const s = m.getMethodSubSignature();
        const sig = new __1.MethodSignature(m.getDeclaringClassSignature(), new __1.MethodSubSignature(s.getMethodName(), [], __1.UnknownType.getInstance()));
        return (0, JsonDto_1.polymorphic)('LexicalEnvType', {
            // method: serializeMethodSignature(type.getNestedMethod()),
            method: serializeMethodSignature(sig),
            closures: type.getClosures().map(closure => serializeLocal(closure)),
        });
    }
    else if (type instanceof __1.EnumValueType) {
        return (0, JsonDto_1.polymorphic)('EnumValueType', {
            signature: serializeClassSignature(type.getFieldSignature().getDeclaringSignature()),
            name: type.getFieldSignature().getFieldName(),
        });
    }
    // Fallback for unhandled type cases
    console.info(`Unhandled Type: ${type.constructor.name} (${type.toString()})`);
    return {
        kind: type.constructor.name,
        text: type.toString(),
    };
}
exports.serializeType = serializeType;
function serializeFileSignature(file) {
    return {
        projectName: file.getProjectName(),
        fileName: file.getFileName(),
    };
}
exports.serializeFileSignature = serializeFileSignature;
function serializeNamespaceSignature(namespace) {
    var _a;
    const dns = (_a = namespace.getDeclaringNamespaceSignature()) !== null && _a !== void 0 ? _a : undefined;
    return {
        name: namespace.getNamespaceName(),
        declaringFile: serializeFileSignature(namespace.getDeclaringFileSignature()),
        declaringNamespace: dns && serializeNamespaceSignature(dns),
    };
}
exports.serializeNamespaceSignature = serializeNamespaceSignature;
function serializeClassSignature(clazz) {
    var _a;
    const dns = (_a = clazz.getDeclaringNamespaceSignature()) !== null && _a !== void 0 ? _a : undefined;
    return {
        name: clazz.getClassName(),
        declaringFile: serializeFileSignature(clazz.getDeclaringFileSignature()),
        declaringNamespace: dns && serializeNamespaceSignature(dns),
    };
}
exports.serializeClassSignature = serializeClassSignature;
function serializeFieldSignature(field) {
    const declaringSignature = field.getDeclaringSignature();
    let declaringClass;
    if (declaringSignature instanceof __1.ClassSignature) {
        declaringClass = serializeClassSignature(declaringSignature);
    }
    else {
        declaringClass = serializeNamespaceSignature(declaringSignature);
    }
    return {
        declaringClass,
        name: field.getFieldName(),
        type: serializeType(field.getType()),
    };
}
exports.serializeFieldSignature = serializeFieldSignature;
function serializeMethodSignature(method) {
    return {
        declaringClass: serializeClassSignature(method.getDeclaringClassSignature()),
        name: method.getMethodSubSignature().getMethodName(),
        parameters: method
            .getMethodSubSignature()
            .getParameters()
            .map(param => serializeMethodParameter(param)),
        returnType: serializeType(method.getType()),
    };
}
exports.serializeMethodSignature = serializeMethodSignature;
function serializeAliasTypeSignature(signature) {
    return {
        name: signature.getName(),
        method: serializeMethodSignature(signature.getDeclaringMethodSignature()),
    };
}
exports.serializeAliasTypeSignature = serializeAliasTypeSignature;
function serializeCfg(cfg) {
    const blocks = Array.from(cfg.getBlocks()).map(block => serializeBasicBlock(block));
    // Sort blocks by their IDs for consistent output:
    blocks.sort((a, b) => a.id - b.id);
    // Check that block IDs match their indices in the array:
    blocks.forEach((block, index) => {
        if (block.id !== index) {
            console.warn(`Block ID ${block.id} does not match its index ${index} in serialized CFG blocks array`);
        }
    });
    return { blocks };
}
exports.serializeCfg = serializeCfg;
function serializeBasicBlock(block) {
    return {
        id: block.getId(),
        successors: block.getSuccessors().map(succ => succ.getId()),
        predecessors: block.getPredecessors().map(pred => pred.getId()),
        stmts: block.getStmts().map(stmt => serializeStmt(stmt)),
    };
}
exports.serializeBasicBlock = serializeBasicBlock;
function serializeLocal(local) {
    return {
        name: local.getName(),
        type: serializeType(local.getType()),
    };
}
exports.serializeLocal = serializeLocal;
function serializeConstant(constant) {
    let value = constant.getValue();
    if (constant.getType() instanceof __1.NumberType) {
        value = Number(value).toString();
    }
    return {
        value,
        type: serializeType(constant.getType()),
    };
}
exports.serializeConstant = serializeConstant;
function serializeValue(value) {
    if (value === undefined) {
        throw new Error('Value is undefined');
    }
    if (value instanceof __1.Local) {
        return (0, JsonDto_1.polymorphic)('Local', serializeLocal(value));
    }
    else if (value instanceof __1.Constant) {
        return (0, JsonDto_1.polymorphic)('Constant', serializeConstant(value));
    }
    else if (value instanceof __1.ArkNewExpr) {
        return (0, JsonDto_1.polymorphic)('NewExpr', {
            classType: serializeType(value.getClassType()),
        });
    }
    else if (value instanceof __1.ArkNewArrayExpr) {
        return (0, JsonDto_1.polymorphic)('NewArrayExpr', {
            elementType: serializeType(value.getBaseType()),
            size: serializeValue(value.getSize()),
        });
    }
    else if (value instanceof __1.ArkDeleteExpr) {
        return (0, JsonDto_1.polymorphic)('DeleteExpr', {
            arg: serializeValue(value.getField()),
        });
    }
    else if (value instanceof __1.ArkAwaitExpr) {
        return (0, JsonDto_1.polymorphic)('AwaitExpr', {
            arg: serializeValue(value.getPromise()),
        });
    }
    else if (value instanceof __1.ArkYieldExpr) {
        return (0, JsonDto_1.polymorphic)('YieldExpr', {
            arg: serializeValue(value.getYieldValue()),
        });
    }
    else if (value instanceof __1.ArkTypeOfExpr) {
        return (0, JsonDto_1.polymorphic)('TypeOfExpr', {
            arg: serializeValue(value.getOp()),
        });
    }
    else if (value instanceof __1.ArkInstanceOfExpr) {
        return (0, JsonDto_1.polymorphic)('InstanceOfExpr', {
            arg: serializeValue(value.getOp()),
            checkType: serializeType(value.getCheckType()),
        });
    }
    else if (value instanceof __1.ArkCastExpr) {
        return (0, JsonDto_1.polymorphic)('CastExpr', {
            arg: serializeValue(value.getOp()),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkPhiExpr) {
        const args = value.getArgs();
        const argToBlock = value.getArgToBlock();
        return (0, JsonDto_1.polymorphic)('PhiExpr', {
            args: args.map(arg => serializeValue(arg)),
            blocks: args.map(arg => argToBlock.get(arg).getId()),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkConditionExpr) {
        return (0, JsonDto_1.polymorphic)('ConditionExpr', {
            op: value.getOperator(),
            left: serializeValue(value.getOp1()),
            right: serializeValue(value.getOp2()),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkNormalBinopExpr) {
        return (0, JsonDto_1.polymorphic)('BinopExpr', {
            op: value.getOperator(),
            left: serializeValue(value.getOp1()),
            right: serializeValue(value.getOp2()),
        });
    }
    else if (value instanceof __1.ArkUnopExpr) {
        return (0, JsonDto_1.polymorphic)('UnopExpr', {
            op: value.getOperator(),
            arg: serializeValue(value.getOp()),
        });
    }
    else if (value instanceof __1.ArkInstanceInvokeExpr) {
        return (0, JsonDto_1.polymorphic)('InstanceCallExpr', {
            instance: serializeValue(value.getBase()),
            method: serializeMethodSignature(value.getMethodSignature()),
            args: value.getArgs().map(arg => serializeValue(arg)),
        });
    }
    else if (value instanceof __1.ArkStaticInvokeExpr) {
        return (0, JsonDto_1.polymorphic)('StaticCallExpr', {
            method: serializeMethodSignature(value.getMethodSignature()),
            args: value.getArgs().map(arg => serializeValue(arg)),
        });
    }
    else if (value instanceof __1.ArkPtrInvokeExpr) {
        return (0, JsonDto_1.polymorphic)('PtrCallExpr', {
            ptr: serializeValue(value.getFuncPtrLocal()),
            method: serializeMethodSignature(value.getMethodSignature()),
            args: value.getArgs().map(arg => serializeValue(arg)),
        });
    }
    else if (value instanceof __1.ArkThisRef) {
        return (0, JsonDto_1.polymorphic)('ThisRef', {
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkParameterRef) {
        return (0, JsonDto_1.polymorphic)('ParameterRef', {
            index: value.getIndex(),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkArrayRef) {
        return (0, JsonDto_1.polymorphic)('ArrayRef', {
            array: serializeValue(value.getBase()),
            index: serializeValue(value.getIndex()),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkCaughtExceptionRef) {
        return (0, JsonDto_1.polymorphic)('CaughtExceptionRef', {
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.GlobalRef) {
        const ref = value.getRef();
        return (0, JsonDto_1.polymorphic)('GlobalRef', {
            name: value.getName(),
            ref: ref ? serializeValue(ref) : null,
        });
    }
    else if (value instanceof __1.ClosureFieldRef) {
        return (0, JsonDto_1.polymorphic)('ClosureFieldRef', {
            base: serializeLocal(value.getBase()),
            fieldName: value.getFieldName(),
            type: serializeType(value.getType()),
        });
    }
    else if (value instanceof __1.ArkInstanceFieldRef) {
        return (0, JsonDto_1.polymorphic)('InstanceFieldRef', {
            instance: serializeValue(value.getBase()),
            field: serializeFieldSignature(value.getFieldSignature()),
        });
    }
    else if (value instanceof __1.ArkStaticFieldRef) {
        return (0, JsonDto_1.polymorphic)('StaticFieldRef', {
            field: serializeFieldSignature(value.getFieldSignature()),
        });
    }
    // Fallback for unhandled value types
    console.info(`Unhandled Value: ${value.constructor.name} (${value.toString()})`);
    return {
        kind: value.constructor.name,
        text: value.toString(),
        type: serializeType(value.getType()),
    };
}
exports.serializeValue = serializeValue;
function serializeStmt(stmt) {
    if (stmt instanceof __1.ArkAssignStmt) {
        return (0, JsonDto_1.polymorphic)('AssignStmt', {
            left: serializeValue(stmt.getLeftOp()),
            right: serializeValue(stmt.getRightOp()),
        });
    }
    else if (stmt instanceof __1.ArkInvokeStmt) {
        return (0, JsonDto_1.polymorphic)('CallStmt', {
            expr: serializeValue(stmt.getInvokeExpr()),
        });
    }
    else if (stmt instanceof __1.ArkIfStmt) {
        return (0, JsonDto_1.polymorphic)('IfStmt', {
            condition: serializeValue(stmt.getConditionExpr()),
        });
    }
    else if (stmt instanceof __1.ArkReturnVoidStmt) {
        return (0, JsonDto_1.polymorphic)('ReturnVoidStmt', {});
    }
    else if (stmt instanceof __1.ArkReturnStmt) {
        return (0, JsonDto_1.polymorphic)('ReturnStmt', {
            arg: serializeValue(stmt.getOp()),
        });
    }
    else if (stmt instanceof __1.ArkThrowStmt) {
        return (0, JsonDto_1.polymorphic)('ThrowStmt', {
            arg: serializeValue(stmt.getOp()),
        });
    }
    // Fallback for unhandled statement types
    console.info(`Unhandled Stmt: ${stmt.constructor.name} (${stmt.toString()})`);
    return {
        kind: stmt.constructor.name,
        text: stmt.toString(),
    };
}
exports.serializeStmt = serializeStmt;
