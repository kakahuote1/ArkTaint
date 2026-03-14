import { ClassSignature, FieldSignature, MethodSignature } from '../../core/model/ArkSignature';
export declare function IsCollectionClass(classSignature: ClassSignature): boolean;
export declare enum BuiltApiType {
    SetConstructor = 0,
    MapConstructor = 1,
    ArrayConstructor = 2,
    SetAdd = 3,
    MapSet = 4,
    MapGet = 5,
    ArrayPush = 6,
    Foreach = 7,
    FunctionCall = 8,
    FunctionApply = 9,
    FunctionBind = 10,
    NotBuiltIn = 11
}
export declare const ARRAY_FIELD_SIGNATURE: FieldSignature;
export declare const SET_FIELD_SIGNATURE: FieldSignature;
export declare const MAP_FIELD_SIGNATURE: FieldSignature;
export declare function getBuiltInApiType(method: MethodSignature): BuiltApiType;
