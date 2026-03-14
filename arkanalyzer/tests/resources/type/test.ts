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

import { A, numberA, objectA } from './exportExample';

function simpleAliasType(): void {
    type BooleanAliasType = boolean;
    type StringAliasType = string;

    function useAliasTypeInParam(param: BooleanAliasType[] | StringAliasType): void {
        console.log(param);
    }
}

function aliasTypeWithImport(): void {
    type ClassAType = import('./exportExample').ClassA;
    type ClassBType = import('./exportExample').default;
    type NumberAType = import('./exportExample').numberA;
    type MultiQualifierType = import('./exportExample').A.B.C;

    type ObjectAType = typeof import('./exportExample').objectA;
    type WholeExportsType = typeof import('./exportExample');

    function useAliasTypeInBody(): void {
        const a: NumberAType[] = [1, 2, 3];
        console.log(a);
    }
}

function aliasTypeWithTypeQuery(): void {
    type SingleTypeQuery = typeof objectA;
    type MultiTypeQuery = typeof objectA.a.b.c;
}

function aliasTypeWithReference(): void {
    type ReferType = numberA;
    type MultiReferType = A.B.C;
}

function aliasTypeWithLiteralType(): void {
    declare type ABC = '123';
    let a: ABC = '123';
    type XYZ = typeof a;
}

function aliasTypeWithFunctionType(): void {
    type FunctionAliasType = typeof aliasTypeWithLiteralType;
    type NumberGenericFunction = typeof functionWithGeneric<number>;
}

function functionWithGeneric<T>(param: T): T {
    return param;
}

function aliasTypeWithUnionType(): void {
    type UnionAliasType = A.B.C | numberA;
}

function aliasTypeWithGenericType(): void {
    type Generic<T> = T;
    type GenericNumber = Generic<number>;

    type GenericArray<T> = T[];
    type GenericArrayNumber = GenericArray<number>;

    type GenericTuple<T, U> = [T, U];
    type GenericTupleStringNumber = GenericTuple<string, number>;

    type GenericObject<X, Y> = {
        x: X,
        y: Y;
    };
    type GenericObjectBooleanNumber = GenericObject<boolean, number>;
}

class ClassWithGeneric<T> {
    private data: T[];
}

function aliasTypeWithClassType(): void {
    type StringClass = ClassWithGeneric<string>;
}

type ParamType<T> = T;

function intersectionTypeWithGeneric(param: ClassWithGeneric<string> & ParamType<number>): ParamType<boolean> {
    type interType = ClassWithGeneric<string> & typeof functionWithGeneric<number>;
    type Generic<T> = T;
    type GenericArray<T> = T[];
    let interLocal: Generic<string> & GenericArray<boolean>;
    return true;
}

class IntersectionClassWithGeneric {
    fieldA: ClassWithGeneric<string> & ParamType<string>;
}

type GlobalType<T> = T;

function globalType(): void {
    type GlobalTypeBoolean = GlobalType<boolean>;
}

class SpecialForIsUnclearCheck {
    A: A.B.C | null;
    static B: A.B.C | null;

    testA(): void {
        this.A?.abc();
    }

    static testB(): void {
        this.B?.abc();
    }
}

async function aliasTypeWithImportDefault(): void {
    let pix: PixelMap = {};
    let b = await pix.getImportInfo();
}