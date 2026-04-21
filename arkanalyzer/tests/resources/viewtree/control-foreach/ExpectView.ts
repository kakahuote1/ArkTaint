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

const Builder_TextArea_Expect_ViewTree = {
    name: 'Row',
    children: [],
    attributes: ['width', 'height', 'backgroundColor', 'create', 'pop']
}

export const ArticleSkeletonView_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Builder',
                    children: [Builder_TextArea_Expect_ViewTree]
                }
            ]
        },
        {
            name: 'Column',
            children: [
                {
                    name: 'Builder',
                    children: [Builder_TextArea_Expect_ViewTree]
                },
                {
                    name: 'Builder',
                    children: [Builder_TextArea_Expect_ViewTree]
                }
            ]
        }
    ],
    attributes: ['create', 'pop', 'padding', 'borderRadius', 'backgroundColor', 'height', 'width', 'justifyContent']
}

export const ForEachTest1_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'ForEach',
            children: [
                {
                    name: 'View',
                    children: [
                        ArticleSkeletonView_Expect_ViewTree
                    ],
                    attributes: ['margin', 'create', 'pop']
                }
            ],
            stateValues: ['simpleList']
        }
    ],
    attributes: ['create', 'padding', 'width', 'height', 'pop']
}

export const ArticleCard_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Image',
            children: []
        },
        {
            name: 'Column',
            children: [
                {
                    name: 'Text',
                    children: [],
                    stateValues: ['article']
                },
                {
                    name: 'Text',
                    children: [],
                    stateValues: ['article']
                }
            ]
        },

    ]
}

export const ForEachTest2_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'List',
            children: [
                {
                    name: 'ForEach',
                    children: [
                        {
                            name: 'ListItem',
                            children: [
                                {
                                    name: 'View',
                                    children: [
                                        ArticleCard_Expect_ViewTree
                                    ]
                                }
                            ]
                        }
                    ],
                    stateValues: ['articleList']
                }
            ],
            stateValues: ['isListReachEnd', 'articleList']
        }
    ]
}

export const ForEachSort_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'List',
            children: [
                {
                    name: 'ForEach',
                    children: [
                        {
                            name: 'ListItem',
                            children: [
                                {
                                    name: 'Text',
                                    children: []
                                }
                            ]
                        }
                    ],
                    stateValues: ['arr']
                }
            ]
        }
    ]
}

export const ChildItem_Expect_ViewTree = {
    name: 'Text',
    children: [],
    stateValues: ['item']
}

export const ForEachTest3_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Text',
                    children: [],
                    stateValues: ['simpleList']
                },
                {
                    name: 'ForEach',
                    children: [
                        {
                            name: 'If',
                            children: [
                                {
                                    name: 'IfBranch',
                                    children: [
                                        {
                                            name: 'View',
                                            children: [
                                                ChildItem_Expect_ViewTree
                                            ]
                                        }
                                    ]
                                }
                            ],
                            stateValues: ['switch']
                        }
                        
                    ],
                    stateValues: ['simpleList']
                }
            ]
        }
    ]
}