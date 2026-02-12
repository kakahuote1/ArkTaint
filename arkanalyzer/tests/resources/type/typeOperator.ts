/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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

class BasicReadonly {
    fieldA: readonly string[] = ['a', 'b'];
    fieldB: boolean[] = [false];

    readonlyVariable(param: readonly [number, string]): readonly boolean[] {
        let tupleLocal: [number, string] = [123, '123'];
        let readonlyTupleLocal: readonly [number, string] = [123, '123'];

        let arrayLocal: number[] = [123, 345];
        let readonlyArrayLocal: readonly number[] = [123, 345];

        let unionLocal: number[] | [number, string];
        let readonlyUnionLocal: readonly number[] | readonly [number, string];

        let intersectionLocal: number[] & [number, string];
        let readonlyIntersectionLocal: readonly number[] & readonly [number, string];

        return [true];
    }

    readonlyAliasType(param: [number, string]): string[] {
        type A = readonly string[];
        type B = readonly string[] | readonly [number, string];
        type C = readonly string[] & readonly [number, string];
        type D = readonly (string & number)[] & readonly (string | number)[];
        type E = string[];
        type F = string[] | [number, string];
        type G = string[] & [number, string];
        return ['hello', 'world'];
    }
}

type A = boolean;

class ReadonlyOfReferenceType {
    fieldA: readonly A[] = [true, false];
    fieldB: readonly [A, boolean] = [true, false];

    readonlyVariable(param: readonly [A, string]): readonly A[] {
        type B = readonly A[] | string;
        let readonlyTupleLocal: readonly [number, B] = [123, '123'];
        let readonlyArrayLocal: readonly B[] = [[true], '123'];
        let readonlyUnionLocal: number[] | readonly A[];
        let readonlyIntersectionLocal: number[] & readonly A[];
        return [true];
    }
}

type C<T> = T;

class ReadonlyOfGenericType {
    fieldA: readonly C<boolean>[] = [true, false];
    fieldB: readonly [C<boolean>, boolean] = [true, false];

    readonlyVariable(param: readonly [C<string>, string]): readonly C<boolean>[] {
        type D = readonly C<number>[] | string;
        let readonlyTupleLocal: readonly [D, string];
        let readonlyArrayLocal: readonly D[];
        let readonlyUnionLocal: number[] | readonly C<string>[] = [123];
        let readonlyIntersectionLocal: number[] & readonly C<string>[] = [123];
        return [true];
    }
}

type PersonType = {
    name: string;
    age: number;
    address: string;
};

const person: PersonType = {
    name: 'Alice',
    age: 30,
    address: '123 Main St',
};

class BasicKeyof {
    private nameKey: keyof PersonType = 'name';
    private ageKey: keyof typeof person = 'age';
    private returnValue: PersonType = person;

    keyofObjectType(property: keyof PersonType): (keyof PersonType)[] {
        type PersonKeys = keyof PersonType; // UnionType of "name" | "age" | "address"
        let p1: PersonKeys = this.nameKey;
        let p2: keyof PersonType = 'age';
        return [p1, p2];
    }

    keyofWithTypeof(property1: keyof typeof person, property2: keyof typeof this.ageKey): keyof typeof this.returnValue {
        type PersonKeys = keyof typeof person;
        let p1: keyof typeof person = this.nameKey;
        let p2: keyof typeof this.returnValue;
        return p1;
    }
}

interface PersonInterface {
    name: string;
    age: number;
}

enum Color {
    Red = 'RED',
    Green = 'GREEN',
    Blue = 'BLUE',
}

class AllKeyofObject {
    keyofPrimitiveType(): void {
        type A = keyof any; // string | number | symbol
        type B = keyof boolean; // "valueOf"
        type C = keyof number; // "toString" | "toFixed"...
        type D = keyof string;
        type E = keyof null;
        type F = keyof undefined;
        type G = keyof void;
        type H = keyof never;
    }

    keyofOtherTypes(): void {
        type ClassKeys = keyof BasicKeyof;
        type InterfaceKeys = keyof PersonInterface;
        type ArrayKeys = keyof string[]; // number | "length" | "toString" | "push" | ...
        type TupleKeys = keyof [string, number]; // "0" | "1" | "length" | "toString" | ...
        type EnumKeys = keyof typeof Color; // "Red" | "Green" | "Blue"
        type LiteralKeys = keyof { a: 1; b: 2 }; // "a" | "b"
        type A = { a: string };
        type B = { b: number };
        type UnionKeys = keyof (A | B); // "a" | "b"
    }
}

type PersonGenericType<T, U> = {
    name: T;
    age: U;
    address: T;
};

const personGeneric: PersonGenericType<string, number> = {
    name: 'Alice',
    age: 30,
    address: '123 Main St',
};

class GenericClass<T> {
    test(t: T): void {};
}

class KeyofWithGeneric {
    private nameKey: keyof PersonGenericType<string, number> = 'name';
    private genericKey: keyof typeof GenericClass<number> = 'prototype';
    private referGenericKey: keyof typeof GenericClass<A> = 'prototype';

    keyofObjectType(property: keyof PersonGenericType<string, number>): (keyof PersonGenericType<string, number>)[] {
        type PersonKeys = keyof PersonGenericType<string, number>;
        let p1: PersonKeys = this.nameKey;
        let p2: keyof PersonGenericType<string, number> = 'age';
        return [p1, p2];
    }

    keyofWithTypeof(property1: keyof typeof personGeneric): keyof typeof personGeneric {
        type PersonKeys = keyof typeof personGeneric;
        let p1: keyof typeof personGeneric = this.nameKey;
        return p1;
    }

    typeofWithGeneric(property1: keyof typeof GenericClass<number>): keyof typeof GenericClass<number> {
        type PersonKeys = keyof typeof GenericClass<number>;
        let p1: keyof typeof GenericClass<number> = this.genericKey;
        return p1;
    }

    typeofWithReferGeneric(property1: keyof typeof GenericClass<A>): keyof typeof GenericClass<A> {
        type PersonKeys = keyof typeof GenericClass<A>;
        let p1: keyof typeof GenericClass<A> = this.genericKey;
        return p1;
    }
}

// TODO: to be support
class KeyofIndexSignatureType {
    keyofIndexSignatureType(): void {
        type Dictionary = {
            [key: string]: number;
        };

        type DictKeys = keyof Dictionary; // string | number
    }
}

// TODO: to be support
class KeyofWithGenericConstraint {
    getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
        return obj[key];
    }

    keyofGenericType(): void {
        const name = this.getProperty(person, 'name');
    }
}

// TODO: to be support
class KeyofMappingType {
    keyofMappingType(): void {
        type ReadonlyPerson = {
            readonly [K in keyof PersonType]: PersonType[K];
        };

        type StringPerson = {
            [K in keyof PersonType]: string;
        };

        const p2: StringPerson = {
            name: 'Alice',
            age: '30'
        };
    }
}
