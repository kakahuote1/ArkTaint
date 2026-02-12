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

export const SpecificParam_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Text', children: []
        },
        {
            name: 'Text', children: []
        }
    ]
}

export const CustomContainer_Builder_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [ SpecificParam_Expect_ViewTree ]
        }
    ],
    stateValues: ['text']
}

export const CustomContainer_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['header']
        },
        {
            name: 'Builder',
            children: [CustomContainer_Builder_Expect_ViewTree],
            builderParam: 'closer'
        }
    ]
}

export const BuilderParamTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'View',
            children: [CustomContainer_Expect_ViewTree],
            stateValues: ['text']
        }
    ]
}

export const Case1_BuilderParamTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'View',
            children: [
                {
                    name: 'Column',
                    children: [
                        {
                            name: 'Builder',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}

export const Case2_BuilderParamTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [
                {
                    name: 'Text', children: []
                }
            ]
        },
        {
            name: 'View',
            children: [
                {
                    name: 'Column',
                    children: [
                        {
                            name: 'Builder',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        },
                        {
                            name: 'Builder',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}

export const Case3_BuilderParamTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [
                {
                    name: 'Text', children: []
                }
            ]
        },
        {
            name: 'View',
            children: [
                {
                    name: 'Column',
                    children: [
                        {
                            name: 'Builder',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        },
                        {
                            name: 'Builder',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}