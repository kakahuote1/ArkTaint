/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

import { ExportType } from '../../../../src/core/model/ArkExport';
import { ArkClass, DEFAULT, Local } from '../../../../src';

export const DefaultExportClassWithDeclaring_Expect_IR = {
    _default: true,
    nameBeforeAs: undefined,
    exportClauseName: DEFAULT,
    exportClauseType: ExportType.CLASS,
    modifiers: ['EXPORT', 'DEFAULT'],
    arkExport: {
        type: ArkClass,
        classSignature: '@exports/class/exportClassNormal.ts: MathUtils',
        modifiers: ['EXPORT', 'DEFAULT']
    }
};

export const ExportClass_Expect_IR = {
    _default: false,
    nameBeforeAs: undefined,
    exportClauseName: 'MathUtils',
    exportClauseType: ExportType.CLASS,
    modifiers: [],
    arkExport: {
        type: ArkClass,
        classSignature: '@exports/class/exportClassNormal.ts: MathUtils',
        modifiers: ['EXPORT', 'DEFAULT']
    }
};

export const ExportClassWithAs_Expect_IR = {
    _default: false,
    nameBeforeAs: 'MathUtils',
    exportClauseName: 'MU',
    exportClauseType: ExportType.CLASS,
    modifiers: [],
    arkExport: {
        type: ArkClass,
        classSignature: '@exports/class/exportClassNormal.ts: MathUtils',
        modifiers: ['EXPORT', 'DEFAULT']
    }
};

export const ExportClassWithDeclaring_Expect_IR = {
    _default: false,
    nameBeforeAs: undefined,
    exportClauseName: 'Test',
    exportClauseType: ExportType.CLASS,
    modifiers: ['EXPORT'],
    arkExport: {
        type: ArkClass,
        classSignature: '@exports/class/exportClassNormal.ts: Test',
        modifiers: ['EXPORT']
    }
};

export const DefaultSingleExportClass_Expect_IR = {
    _default: true,
    nameBeforeAs: 'MathUtils',
    exportClauseName: DEFAULT,
    exportClauseType: ExportType.CLASS,
    modifiers: ['DEFAULT'],
    arkExport: {
        type: ArkClass,
        classSignature: '@exports/class/singleExportClass.ts: MathUtils',
        modifiers: []
    }
};

export const DefaultExportClassInstanceWithNewIndependent_Expect_IR = {
    _default: true,
    nameBeforeAs: undefined,
    exportClauseName: DEFAULT,
    exportClauseType: ExportType.LOCAL,
    modifiers: ['DEFAULT'],
    arkExport: {
        type: Local,
        local: {
            type: ArkClass,
            classSignature: '@exports/class/exportClassInstanceWithNewIndependent.ts: MathUtils'
        }
    }
};

export const DefaultExportClassInstanceWithNew_Expect_IR = {
    _default: true,
    nameBeforeAs: undefined,
    exportClauseName: DEFAULT,
    exportClauseType: ExportType.LOCAL,
    modifiers: ['DEFAULT'],
    arkExport: {
        type: Local,
        local: {
            type: ArkClass,
            classSignature: '@exports/class/exportClassInstanceWithNew.ts: MathUtils'
        }
    }
};

export const DefaultExportClassInstanceWithLetIndependent_Expect_IR = {
    _default: true,
    nameBeforeAs: 'MU',
    exportClauseName: DEFAULT,
    exportClauseType: ExportType.LOCAL,
    modifiers: ['DEFAULT'],
    arkExport: {
        type: Local,
        local: {
            type: ArkClass,
            classSignature: '@exports/class/exportClassInstanceWithLet.ts: MathUtils'
        }
    }
};

export const ExportClassInstanceWithLet_Expect_IR = {
    _default: false,
    nameBeforeAs: undefined,
    exportClauseName: 'MUInstance',
    exportClauseType: ExportType.LOCAL,
    modifiers: ['EXPORT'],
    arkExport: {
        type: Local,
        local: {
            type: ArkClass,
            classSignature: '@exports/class/exportClassInstanceWithLet.ts: MathUtils'
        }
    }
};
