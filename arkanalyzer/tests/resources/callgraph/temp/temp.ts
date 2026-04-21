/*
 * Copyright (c) 2022-2023 Huawei Device Co., Ltd.
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
// @ts-nocheck
import Extension from '@ohos.application.FileAccessExtensionAbility';
import fs from '@ohos.file.fs';
import type { Filter } from '@ohos.file.fs';
import fileAccess from '@ohos.file.fileAccess';
import fileExtensionInfo from '@ohos.file.fileExtensionInfo';
import hilog from '@ohos.hilog';
import { getFileInfos, buildFilterOptions, buildNoFilterOptions, hasFilter } from './ListScanFileInfo';
import type { Fileinfo } from './Common';
import { getPath, checkUri, encodePathOfUri, decodeUri, uriReturnObject, BUNDLE_NAME, DOMAIN_CODE, fileinfoReturnObject } from './Common';
import { FILE_PREFIX_NAME, TAG, fdReturnObject, boolReturnObject, rootsReturnObject } from './Common';
import { infosReturnObject, resultsResultObject } from './Common';


export default class FileExtAbility extends Extension {
  moveItem(): { [], number } {
    
  }
};