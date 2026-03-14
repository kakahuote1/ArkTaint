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
exports.ONMESSAGEFUNCNAME = exports.POSTMESSAGEWITHSHAREDSENDABLEFUNCNAME = exports.POSTMESSAGEFUNCNAME = exports.CONSTRUCTORFUCNNAME = exports.MAKEOBSERVED = exports.ARKTS_STATIC_MARK = exports.LEXICAL_ENV_NAME_PREFIX = exports.TEMP_LOCAL_PREFIX = exports.UNKNOWN_METHOD_NAME = exports.UNKNOWN_FIELD_NAME = exports.UNKNOWN_CLASS_NAME = exports.UNKNOWN_NAMESPACE_NAME = exports.UNKNOWN_FILE_NAME = exports.UNKNOWN_PROJECT_NAME = exports.SETTER_PREFIX = exports.GETTER_PREFIX = exports.CALL_SIGNATURE_NAME = exports.ANONYMOUS_METHOD_PREFIX = exports.STATIC_BLOCK_METHOD_NAME_PREFIX = exports.STATIC_INIT_METHOD_NAME = exports.INSTANCE_INIT_METHOD_NAME = exports.DEFAULT_ARK_METHOD_NAME = exports.NESTED_CLASS_METHOD_DELIMITER = exports.ANONYMOUS_CLASS_DELIMITER = exports.ANONYMOUS_CLASS_PREFIX = exports.DEFAULT_ARK_CLASS_NAME = exports.DEFAULT_NAME = exports.UNKNOWN_NAME = exports.NAME_PREFIX = exports.NAME_DELIMITER = void 0;
// names
exports.NAME_DELIMITER = '$';
exports.NAME_PREFIX = '%';
exports.UNKNOWN_NAME = 'unk';
exports.DEFAULT_NAME = 'dflt';
// ArkClass const
exports.DEFAULT_ARK_CLASS_NAME = exports.NAME_PREFIX + exports.DEFAULT_NAME;
exports.ANONYMOUS_CLASS_PREFIX = exports.NAME_PREFIX + 'AC';
exports.ANONYMOUS_CLASS_DELIMITER = exports.NAME_DELIMITER;
exports.NESTED_CLASS_METHOD_DELIMITER = '-';
// ArkMethod const
exports.DEFAULT_ARK_METHOD_NAME = exports.NAME_PREFIX + exports.DEFAULT_NAME;
exports.INSTANCE_INIT_METHOD_NAME = exports.NAME_PREFIX + 'instInit';
exports.STATIC_INIT_METHOD_NAME = exports.NAME_PREFIX + 'statInit';
exports.STATIC_BLOCK_METHOD_NAME_PREFIX = exports.NAME_PREFIX + 'statBlock';
exports.ANONYMOUS_METHOD_PREFIX = exports.NAME_PREFIX + 'AM';
exports.CALL_SIGNATURE_NAME = 'create';
exports.GETTER_PREFIX = 'Get-';
exports.SETTER_PREFIX = 'Set-';
// ArkSignature const
exports.UNKNOWN_PROJECT_NAME = exports.NAME_PREFIX + exports.UNKNOWN_NAME;
exports.UNKNOWN_FILE_NAME = exports.NAME_PREFIX + exports.UNKNOWN_NAME;
exports.UNKNOWN_NAMESPACE_NAME = exports.NAME_PREFIX + exports.UNKNOWN_NAME;
exports.UNKNOWN_CLASS_NAME = ''; // temp for being compatible with existing type inference
exports.UNKNOWN_FIELD_NAME = ''; // temp for being compatible with existing type inference
exports.UNKNOWN_METHOD_NAME = ''; // temp for being compatible with existing type inference
// IR const
exports.TEMP_LOCAL_PREFIX = exports.NAME_PREFIX;
exports.LEXICAL_ENV_NAME_PREFIX = exports.TEMP_LOCAL_PREFIX + 'closures';
// ArkTS version
exports.ARKTS_STATIC_MARK = 'use static';
// Concurrent const
exports.MAKEOBSERVED = 'makeObserved';
exports.CONSTRUCTORFUCNNAME = 'constructor';
exports.POSTMESSAGEFUNCNAME = 'postMessage';
exports.POSTMESSAGEWITHSHAREDSENDABLEFUNCNAME = 'postMessageWithSharedSendable';
exports.ONMESSAGEFUNCNAME = 'onmessage';
//# sourceMappingURL=Const.js.map