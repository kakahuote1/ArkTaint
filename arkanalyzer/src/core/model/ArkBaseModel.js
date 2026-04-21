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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkBaseModel = exports.MODIFIER_TYPE_MASK = exports.ModifierType = void 0;
exports.modifierKind2Enum = modifierKind2Enum;
exports.modifiers2stringArray = modifiers2stringArray;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const EtsConst_1 = require("../common/EtsConst");
const ArkError_1 = require("../common/ArkError");
const logger_1 = __importStar(require("../../utils/logger"));
const ArkMetadata_1 = require("./ArkMetadata");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkBaseModel');
const COMPONENT_MEMBER_DECORATORS = new Set([
    'State',
    'Prop',
    'Link',
    'StorageProp',
    'StorageLink',
    'Provide',
    'Consume',
    'ObjectLink',
    'LocalStorageLink',
    'LocalStorageProp',
    'Local',
    'Param',
    'Event',
    'Provider',
    'Consumer',
]);
var ModifierType;
(function (ModifierType) {
    ModifierType[ModifierType["PRIVATE"] = 1] = "PRIVATE";
    ModifierType[ModifierType["PROTECTED"] = 2] = "PROTECTED";
    ModifierType[ModifierType["PUBLIC"] = 4] = "PUBLIC";
    ModifierType[ModifierType["EXPORT"] = 8] = "EXPORT";
    ModifierType[ModifierType["STATIC"] = 16] = "STATIC";
    ModifierType[ModifierType["ABSTRACT"] = 32] = "ABSTRACT";
    ModifierType[ModifierType["ASYNC"] = 64] = "ASYNC";
    ModifierType[ModifierType["CONST"] = 128] = "CONST";
    ModifierType[ModifierType["ACCESSOR"] = 256] = "ACCESSOR";
    ModifierType[ModifierType["DEFAULT"] = 512] = "DEFAULT";
    ModifierType[ModifierType["IN"] = 1024] = "IN";
    ModifierType[ModifierType["READONLY"] = 2048] = "READONLY";
    ModifierType[ModifierType["OUT"] = 4096] = "OUT";
    ModifierType[ModifierType["OVERRIDE"] = 8192] = "OVERRIDE";
    ModifierType[ModifierType["DECLARE"] = 16384] = "DECLARE";
    ModifierType[ModifierType["TYPE"] = 32768] = "TYPE";
    ModifierType[ModifierType["LAZY"] = 65536] = "LAZY";
})(ModifierType || (exports.ModifierType = ModifierType = {}));
exports.MODIFIER_TYPE_MASK = 0xffff;
const MODIFIER_TYPE_STRINGS = [
    'private',
    'protected',
    'public',
    'export',
    'static',
    'abstract',
    'async',
    'const',
    'accessor',
    'default',
    'in',
    'readonly',
    'out',
    'override',
    'declare',
];
const MODIFIER_KIND_2_ENUM = new Map([
    [ohos_typescript_1.default.SyntaxKind.AbstractKeyword, ModifierType.ABSTRACT],
    [ohos_typescript_1.default.SyntaxKind.AccessorKeyword, ModifierType.ACCESSOR],
    [ohos_typescript_1.default.SyntaxKind.AsyncKeyword, ModifierType.ASYNC],
    [ohos_typescript_1.default.SyntaxKind.ConstKeyword, ModifierType.CONST],
    [ohos_typescript_1.default.SyntaxKind.DeclareKeyword, ModifierType.DECLARE],
    [ohos_typescript_1.default.SyntaxKind.DefaultKeyword, ModifierType.DEFAULT],
    [ohos_typescript_1.default.SyntaxKind.ExportKeyword, ModifierType.EXPORT],
    [ohos_typescript_1.default.SyntaxKind.InKeyword, ModifierType.IN],
    [ohos_typescript_1.default.SyntaxKind.PrivateKeyword, ModifierType.PRIVATE],
    [ohos_typescript_1.default.SyntaxKind.ProtectedKeyword, ModifierType.PROTECTED],
    [ohos_typescript_1.default.SyntaxKind.PublicKeyword, ModifierType.PUBLIC],
    [ohos_typescript_1.default.SyntaxKind.ReadonlyKeyword, ModifierType.READONLY],
    [ohos_typescript_1.default.SyntaxKind.OutKeyword, ModifierType.OUT],
    [ohos_typescript_1.default.SyntaxKind.OverrideKeyword, ModifierType.OVERRIDE],
    [ohos_typescript_1.default.SyntaxKind.StaticKeyword, ModifierType.STATIC],
    [ohos_typescript_1.default.SyntaxKind.TypeKeyword, ModifierType.TYPE],
    [ohos_typescript_1.default.SyntaxKind.LazyKeyword, ModifierType.LAZY],
]);
function modifierKind2Enum(kind) {
    return MODIFIER_KIND_2_ENUM.get(kind);
}
function modifiers2stringArray(modifiers) {
    let strs = [];
    for (let idx = 0; idx < MODIFIER_TYPE_STRINGS.length; idx++) {
        if (modifiers & 0x01) {
            strs.push(MODIFIER_TYPE_STRINGS[idx]);
        }
        modifiers = modifiers >>> 1;
    }
    return strs;
}
class ArkBaseModel {
    getMetadata(kind) {
        return this.metadata?.getMetadata(kind);
    }
    setMetadata(kind, value) {
        if (!this.metadata) {
            this.metadata = new ArkMetadata_1.ArkMetadata();
        }
        return this.metadata?.setMetadata(kind, value);
    }
    getModifiers() {
        if (!this.modifiers) {
            return 0;
        }
        return this.modifiers;
    }
    setModifiers(modifiers) {
        if (modifiers !== 0) {
            this.modifiers = modifiers;
        }
    }
    addModifier(modifier) {
        this.modifiers = this.getModifiers() | modifier;
    }
    removeModifier(modifier) {
        if (!this.modifiers) {
            return;
        }
        this.modifiers &= exports.MODIFIER_TYPE_MASK ^ modifier;
    }
    isStatic() {
        return this.containsModifier(ModifierType.STATIC);
    }
    isProtected() {
        return this.containsModifier(ModifierType.PROTECTED);
    }
    isPrivate() {
        return this.containsModifier(ModifierType.PRIVATE);
    }
    isPublic() {
        return this.containsModifier(ModifierType.PUBLIC);
    }
    isReadonly() {
        return this.containsModifier(ModifierType.READONLY);
    }
    isAbstract() {
        return this.containsModifier(ModifierType.ABSTRACT);
    }
    isExport() {
        return this.containsModifier(ModifierType.EXPORT);
    }
    isDefault() {
        return this.containsModifier(ModifierType.DEFAULT);
    }
    /** @deprecated Use {@link isExport} instead. */
    isExported() {
        return this.isExport();
    }
    isDeclare() {
        return this.containsModifier(ModifierType.DECLARE);
    }
    containsModifier(modifierType) {
        if (!this.modifiers) {
            return false;
        }
        return (this.modifiers & modifierType) === modifierType;
    }
    getDecorators() {
        if (this.decorators) {
            return Array.from(this.decorators);
        }
        return [];
    }
    setDecorators(decorators) {
        if (decorators.size > 0) {
            this.decorators = decorators;
        }
    }
    addDecorator(decorator) {
        if (!this.decorators) {
            this.decorators = new Set();
        }
        this.decorators.add(decorator);
    }
    removeDecorator(kind) {
        this.decorators?.forEach(value => {
            if (value.getKind() === kind) {
                this.decorators?.delete(value);
            }
        });
    }
    hasBuilderDecorator() {
        return this.hasDecorator(EtsConst_1.BUILDER_DECORATOR);
    }
    getStateDecorators() {
        if (!this.decorators) {
            return [];
        }
        return Array.from(this.decorators).filter(item => {
            return COMPONENT_MEMBER_DECORATORS.has(item.getKind());
        });
    }
    hasBuilderParamDecorator() {
        return this.hasDecorator(EtsConst_1.BUILDER_PARAM_DECORATOR);
    }
    hasEntryDecorator() {
        return this.hasDecorator(EtsConst_1.ENTRY_DECORATOR);
    }
    hasComponentDecorator() {
        return this.hasDecorator(EtsConst_1.COMPONENT_DECORATOR);
    }
    hasDecorator(kind) {
        let decorators = this.getDecorators();
        return (decorators.filter(value => {
            if (kind instanceof Set) {
                return kind.has(value.getKind());
            }
            return value.getKind() === kind;
        }).length !== 0);
    }
    validateFields(fields) {
        let errs = [];
        for (const field of fields) {
            let value = Reflect.get(this, field);
            if (!value) {
                errs.push(field);
            }
        }
        if (errs.length === 0) {
            return { errCode: ArkError_1.ArkErrorCode.OK };
        }
        logger.error(`class fields: ${errs.join(',')} is undefined.`);
        return {
            errCode: ArkError_1.ArkErrorCode.CLASS_INSTANCE_FIELD_UNDEFINED,
            errMsg: `${errs.join(',')} is undefined.`,
        };
    }
}
exports.ArkBaseModel = ArkBaseModel;
//# sourceMappingURL=ArkBaseModel.js.map