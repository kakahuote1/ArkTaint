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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbcFieldRefInference = exports.AbcInferenceBuilder = exports.AbcMethodInference = void 0;
const ModelInference_1 = require("../ModelInference");
const ModelUtils_1 = require("../../common/ModelUtils");
const ArkMethod_1 = require("../../model/ArkMethod");
const ArkSignature_1 = require("../../model/ArkSignature");
const InferenceBuilder_1 = require("../InferenceBuilder");
const SdkUtils_1 = require("../../common/SdkUtils");
const ValueInference_1 = require("../ValueInference");
const TypeInference_1 = require("../../common/TypeInference");
const Type_1 = require("../../base/Type");
const Local_1 = require("../../base/Local");
const Ref_1 = require("../../base/Ref");
const ArkTsInference_1 = require("../arkts/ArkTsInference");
class AbcImportInference extends ModelInference_1.ImportInfoInference {
    /**
     * get arkFile and assign to from file
     * @param fromInfo
     */
    preInfer(fromInfo) {
        const from = fromInfo.getFrom();
        if (!from) {
            return;
        }
        let file;
        if (/^([^@]*\/)([^\/]*)$/.test(from)) {
            const scene = fromInfo.getDeclaringArkFile().getScene();
            file = scene.getFile(new ArkSignature_1.FileSignature(fromInfo.getDeclaringArkFile().getProjectName(), from));
        }
        else {
            //sdk path
            file = SdkUtils_1.SdkUtils.getImportSdkFile(from);
        }
        if (file) {
            this.fromFile = file;
        }
    }
}
class AbcMethodInference extends ModelInference_1.MethodInference {
    preInfer(arkMethod) {
        const implSignature = arkMethod.getImplementationSignature();
        if (implSignature) {
            this.inferArkUIComponentLifeCycleMethod(arkMethod, implSignature);
        }
    }
    inferArkUIComponentLifeCycleMethod(arkMethod, impl) {
        const arkClass = arkMethod.getDeclaringArkClass();
        const scene = arkClass.getDeclaringArkFile().getScene();
        const classes = arkClass
            .getAllHeritageClasses()
            .filter(cls => scene.getProjectSdkMap().has(cls.getSignature().getDeclaringFileSignature().getProjectName()));
        for (const sdkClass of classes) {
            // findPropertyInClass function will check all super classes recursely to find the method
            const sdkMethod = ModelUtils_1.ModelUtils.findPropertyInClass(arkMethod.getName(), sdkClass);
            if (!sdkMethod || !(sdkMethod instanceof ArkMethod_1.ArkMethod)) {
                continue;
            }
            const sdkDeclareSigs = sdkMethod.getDeclareSignatures();
            // It is difficult to get the exactly declare signature when there are more than 1 declare signatures.
            // So currently only match the SDK with no override.
            if (!sdkDeclareSigs || sdkDeclareSigs.length !== 1) {
                continue;
            }
            const params = impl.getMethodSubSignature().getParameters();
            const sdkMethodSig = sdkDeclareSigs[0];
            const sdkParams = sdkMethodSig.getMethodSubSignature().getParameters();
            params.forEach((param, index) => {
                if (index < sdkParams.length) {
                    param.setType(sdkParams[index].getType());
                }
            });
            impl.getMethodSubSignature().setReturnType(sdkMethodSig.getMethodSubSignature().getReturnType());
            return;
        }
    }
}
exports.AbcMethodInference = AbcMethodInference;
class AbcStmtInference extends ModelInference_1.StmtInference {
    constructor(valueInferences) {
        super(valueInferences);
    }
    transferRight2Left(leftOp, rightType, method) {
        const projectName = method.getDeclaringArkFile().getProjectName();
        if (!TypeInference_1.TypeInference.isUnclearType(rightType) || rightType instanceof Type_1.GenericType || !TypeInference_1.TypeInference.isAnonType(rightType, projectName)) {
            let leftType = leftOp.getType();
            if (TypeInference_1.TypeInference.isTypeCanBeOverride(leftType)) {
                leftType = rightType;
            }
            else {
                leftType = TypeInference_1.TypeInference.union(leftType, rightType);
            }
            if (leftOp.getType() !== leftType) {
                return ArkTsInference_1.ArkTsStmtInference.updateUnionType(leftOp, leftType, method);
            }
        }
        return undefined;
    }
    updateValueType(target, srcType, method) {
        const type = target.getType();
        const projectName = method.getDeclaringArkFile().getProjectName();
        if (type !== srcType && (TypeInference_1.TypeInference.isUnclearType(type) || !TypeInference_1.TypeInference.isAnonType(type, projectName))) {
            if (target instanceof Local_1.Local) {
                target.setType(srcType);
                return target.getUsedStmts();
            }
            else if (target instanceof Ref_1.AbstractFieldRef) {
                target.getFieldSignature().setType(srcType);
            }
            else if (target instanceof Ref_1.ArkParameterRef) {
                target.setType(srcType);
            }
        }
        return undefined;
    }
}
class AbcInferenceBuilder extends InferenceBuilder_1.InferenceBuilder {
    buildImportInfoInference() {
        return new AbcImportInference();
    }
    buildMethodInference() {
        return new AbcMethodInference(this.buildStmtInference());
    }
    buildStmtInference() {
        const valueInferences = this.getValueInferences(ValueInference_1.InferLanguage.COMMON);
        this.getValueInferences(ValueInference_1.InferLanguage.ABC).forEach(e => valueInferences.push(e));
        return new AbcStmtInference(valueInferences);
    }
}
exports.AbcInferenceBuilder = AbcInferenceBuilder;
let AbcFieldRefInference = class AbcFieldRefInference extends ValueInference_1.FieldRefInference {
    getValueName() {
        return 'ArkInstanceFieldRef';
    }
    preInfer(value, stmt) {
        const type = value.getType();
        const projectName = stmt.getCfg().getDeclaringMethod().getDeclaringArkFile().getProjectName();
        if (TypeInference_1.TypeInference.isAnonType(type, projectName)) {
            const baseType = value.getBase().getType();
            if (!TypeInference_1.TypeInference.isUnclearType(baseType) && !TypeInference_1.TypeInference.isAnonType(baseType, projectName)) {
                return true;
            }
        }
        return super.preInfer(value, stmt);
    }
};
exports.AbcFieldRefInference = AbcFieldRefInference;
exports.AbcFieldRefInference = AbcFieldRefInference = __decorate([
    (0, ValueInference_1.Bind)(ValueInference_1.InferLanguage.ABC)
], AbcFieldRefInference);
//# sourceMappingURL=AbcInference.js.map