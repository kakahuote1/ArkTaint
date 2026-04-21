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

/**
 * Provides international settings related APIs.
 *
 * @syscap SystemCapability.Global.I18n
 * @since 7
 */
declare namespace i18n {
    /**
     * Obtains the country or region name localized for display on a given locale.
     *
     * @syscap SystemCapability.Global.I18n
     * @param country The locale whose country or region name will be displayed.
     * @param locale The locale used to display the country or region.
     * @param sentenceCase Specifies whether the country or region name is displayed in sentence case.
     * @returns Returns the country or region name localized for display on a given locale.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.getDisplayCountry
     */
    export function getDisplayCountry(country: string, locale: string, sentenceCase?: boolean): string;

    /**
     * Obtains the language name localized for display on a given locale.
     *
     * @syscap SystemCapability.Global.I18n
     * @param language The locale whose language name will be displayed.
     * @param locale The locale used to display the language.
     * @param sentenceCase Specifies whether the language name is displayed in sentence case.
     * @returns Returns the language name localized for display on a given locale.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.getDisplayLanguage
     */
    export function getDisplayLanguage(language: string, locale: string, sentenceCase?: boolean): string;

    /**
     * Obtains the language currently used by the system.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns the language currently used by the system.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.getSystemLanguage
     */
    export function getSystemLanguage(): string;

    /**
     * Obtains the region currently used by the system.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns the region currently used by the system.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.getSystemRegion
     */
    export function getSystemRegion(): string;

    /**
     * Obtains the locale currently used by the system.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns the locale currently used by the system.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.getSystemLocale
     */
    export function getSystemLocale(): string;

    /**
     * Provides system functions.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 9
     */
    export class System {
        /**
         * Obtains the country or region name localized for display on a given locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param country The locale whose country or region name will be displayed.
         * @param locale The locale used to display the country or region.
         * @param sentenceCase Specifies whether the country or region name is displayed in sentence case.
         * @throws {BusinessError} 401 - check param failed
         * @throws {BusinessError} 890001 - param value not valid
         * @returns Returns the country or region name localized for display on a given locale.
         * @since 9
         */
        static getDisplayCountry(country: string, locale: string, sentenceCase?: boolean): string;

        /**
         * Obtains the language name localized for display on a given locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param language The locale whose language name will be displayed.
         * @param locale The locale used to display the language.
         * @param sentenceCase Specifies whether the language name is displayed in sentence case.
         * @throws {BusinessError} 401 - check param failed
         * @throws {BusinessError} 890001 - param value not valid
         * @returns Returns the language name localized for display on a given locale.
         * @since 9
         */
        static getDisplayLanguage(language: string, locale: string, sentenceCase?: boolean): string;

        /**
         * Obtains all languages supported by the system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns all languages supported by the system.
         * @since 9
         */
        static getSystemLanguages(): Array<string>;

        /**
         * Obtains all regions supported by the system in the language.
         *
         * @syscap SystemCapability.Global.I18n
         * @param language The language used to get the list of regions.
         * @throws {BusinessError} 401 - check param failed
         * @throws {BusinessError} 890001 - param value not valid
         * @returns Returns all countries or regions supported by the system in the language.
         * @since 9
         */
        static getSystemCountries(language: string): Array<string>;

        /**
         * Determine whether the current language or region is recommended.
         *
         * @syscap SystemCapability.Global.I18n
         * @param language The language code.
         * @param region The region code.
         * @throws {BusinessError} 401 - check param failed
         * @throws {BusinessError} 890001 - param value not valid
         * @returns Returns whether the current language or region is recommended.
         * @since 9
         */
        static isSuggested(language: string, region?: string): boolean;

        /**
         * Obtains the language currently used by the system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the language currently used by the system.
         * @since 9
         */
        static getSystemLanguage(): string;

        /**
         * Obtains the region currently used by the system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the region currently used by the system.
         * @since 9
         */
        static getSystemRegion(): string;

        /**
         * Obtains the locale currently used by the system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the locale currently used by the system.
         * @since 9
         */
        static getSystemLocale(): string;

        /**
         * Check out whether system is 24-hour system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a boolean represent whether system is 24-hour system.
         * @since 9
         */
        static is24HourClock(): boolean;

        /**
         * Access the system preferred language list.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string Array represent the preferred language list.
         * @since 9
         */
        static getPreferredLanguageList(): Array<string>;

        /**
         * Get the first preferred language of system.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string represent the first preferred language of system.
         * @since 9
         */
        static getFirstPreferredLanguage(): string;

        /**
         * Get the preferred language of App.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string represent the preferred language of App.
         * @since 9
         */
        static getAppPreferredLanguage(): string;

        /**
         * Get whether to use local digit.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a boolean represents whether to use local digit.
         * @since 9
         */
        static getUsingLocalDigit(): boolean;
    }

    /**
     * Provides util functions.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     * @deprecated since 9
     * @useinstead I18NUtil
     */
    export interface Util {
        /**
         * Convert from unit to unit and format according to the locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param fromUnit Information of the unit to be converted.
         * @param toUnit Information about the unit to be converted to.
         * @param value Indicates the number to be formatted.
         * @param locale The locale to be used.
         * @param style The style of format.
         * @since 8
         * @deprecated since 9
         * @useinstead I18NUtil.unitConvert
         */
        unitConvert(fromUnit: UnitInfo, toUnit: UnitInfo, value: number, locale: string, style?: string): string;
    }

    /**
     * Provides util functions.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 9
     */
    export class I18NUtil {
        /**
         * Convert from unit to unit and format according to the locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { UnitInfo } fromUnit - Information of the unit to be converted.
         * @param { UnitInfo } toUnit - Information about the unit to be converted to.
         * @param { number } value - Indicates the number to be formatted.
         * @param { string } locale - The locale to be used.
         * @param { string } [ style ] - The style of format.
         * @since 9
         */
        static unitConvert(fromUnit: UnitInfo, toUnit: UnitInfo, value: number, locale: string, style?: string): string;

        /**
         * Get the order of year, month, day in the specified locale. Year, month, day are separated by '-'.
         * 'y' stands for year, 'L' stands for month, d stands for day.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } locale - Information of the locale
         * @returns Returns the string of 'y', 'L', 'd' joined by '-'.
         * @since 9
         */
        static getDateOrder(locale: string): string;
    }

    /**
     * Provides the options of unit.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     */
    export interface UnitInfo {
        /**
         * Unit name.
         */
        unit: string;
        /**
         * The measurement system of the unit.
         */
        measureSystem: string;
    }

    /**
     * Provides the options of PhoneNumberFormat.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     */
    export interface PhoneNumberFormatOptions {
        /**
         * Indicates the type to format phone number.
         *
         * @type { string } type
         * @since 8
         */
        /**
         * Indicates the type to format phone number.
         *
         * @type { string } [ type ]
         * @since 9
         */
        type?: string;
    }

    /**
     * Provides the API for formatting phone number strings
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     */
    export class PhoneNumberFormat {
        /**
         * A constructor used to create a PhoneNumberFormat object.
         *
         * @syscap SystemCapability.Global.I18n
         * @param country Indicates a character string containing the country information for the PhoneNumberFormat object.
         * @param type Indicates the type used to format the phone number, includes: "E164", "RFC3966", "INTERNATIONAL", "NATIONAL".
         * @since 8
         */
        constructor(country: string, options?: PhoneNumberFormatOptions);

        /**
         * Judge whether phone number is valid.
         *
         * @syscap SystemCapability.Global.I18n
         * @param number Indicates the input phone number.
         * @returns Returns a boolean indicates whether the input phone number is valid.
         * @since 8
         */
        isValidNumber(number: string): boolean;

        /**
         * Obtains the formatted phone number strings of number.
         *
         * @syscap SystemCapability.Global.I18n
         * @param number Indicates the input phone number to be formatted.
         * @returns Returns the formatted phone number.
         * @since 8
         */
        format(number: string): string;

        /**
         * Determine the location by phone number, and return it according to the specified regional language.
         *
         * @syscap SystemCapability.Global.I18n
         * @param number input phone number.
         * @param locale locale ID.
         * @returns Returns a string represents phone number's location.
         * @since 9
         */
        getLocationName(number: string, locale: string): string;
    }

    /**
     * Get a Calendar instance specified by locale and type.
     *
     * @syscap SystemCapability.Global.I18n
     * @param locale The locale used to get calendar.
     * @param type If type is not specified, get locale's default Calendar, else get the specified type of Calendar.
     *  such as buddhist, chinese, coptic, ethiopic, hebrew, gregory, indian, islamic_civil, islamic_tbla, islamic_umalqura,
     *  japanese, persian.
     * @since 8
     */
    export function getCalendar(locale: string, type?: string): Calendar;

    export class Calendar {
        /**
         * set the date.
         *
         * @syscap SystemCapability.Global.I18n
         * @param date Date object used to set the time and date.
         * @since 8
         */
        setTime(date: Date): void;
        /**
         * set the time.
         *
         * @syscap SystemCapability.Global.I18n
         * @param time Indicates the elapsed milliseconds from 1970.1.1 00:00:00 GMT.
         * @since 8
         */
        setTime(time: number): void;

        /**
         * Set the time
         *
         * @syscap SystemCapability.Global.I18n
         * @param year The year field of the calendar, ranges from 0 to 9999.
         * @param month The month field of the calendar, ranges from 0 to 11.
         * @param date The day field of the calendar, ranges from 1 to 31.
         * @param hour The hour field of the calendar, ranges from 0 to 23.
         * @param minute The minute field of the calendar, ranges from 0 to 59.
         * @param second the second field of the calendar, ranges from 0 to 59.
         * @since 8
         */
        set(year: number, month: number, date: number, hour?: number, minute?: number, second?: number): void;

        /**
         * Set the timezone of this calendar.
         *
         * @syscap SystemCapability.Global.I18n
         * @param timezone The id of a timezone.
         * @since 8
         */
        setTimeZone(timezone: string): void;

        /**
         * Get the timezone id of this calendar instance.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the timezone id of this calendar.
         * @since 8
         */
        getTimeZone(): string;

        /**
         * Get the start day of a week. 1 indicates Sunday, 7 indicates Saturday.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns start day of a week.
         * @since 8
         */
        getFirstDayOfWeek(): number;

        /**
         * Set the start day of a week. 1 indicates Sunday, 7 indicates Saturday.
         *
         * @syscap SystemCapability.Global.I18n
         * @param value Indicates the start day of a week. 1 indicates Sunday, 7 indicates Saturday.
         * @since 8
         */
        setFirstDayOfWeek(value: number): void;

        /**
         * Get the minimal days of a week, which is needed for the first day of a year.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the minimal days of a week.
         * @since 8
         */
        getMinimalDaysInFirstWeek(): number;

        /**
         * Set the minimal days of a week, which is needed for the first week of a year.
         *
         * @syscap SystemCapability.Global.I18n
         * @param value The value to be set.
         * @since 8
         */
        setMinimalDaysInFirstWeek(value: number): void;

        /**
         * Get the associated value with the field.
         *
         * @syscap SystemCapability.Global.I18n
         * @param field Field values such as era, year, month, week_of_year, week_of_month, date, day_of_year, day_of_week
         *  day_of_week_in_month, hour, hour_of_day, minute, second, millisecond, zone_offset, dst_offset, year_woy,
         *  dow_local, extended_year, julian_day, milliseconds_in_day, is_leap_month.
         * @returns Return the associated value.
         * @since 8
         */
        get(field: string): number;

        /**
         * Get calendar's name localized for display in the given locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param locale Locale used to get the localized name for this calendar.
         * @returns Returns the localized name of this calendar.
         * @since 8
         */
        getDisplayName(locale: string): string;

        /**
         * Returns true if the given date is a weekend day. If the date is not given,
         *  the date object of this calendar is used.
         *
         * @syscap SystemCapability.Global.I18n
         * @param date Date object whose attribute is desired.
         * @returns Returns whether the date is a weekend day.
         * @since 8
         */
        isWeekend(date?: Date): boolean;
    }

    /**
     * Judge whether the locale is RTL locale.
     *
     * @syscap SystemCapability.Global.I18n
     * @param locale The locale to be used.
     * @returns Returns true representing the locale is an RTL locale
     *
     * @since 7
     */
    export function isRTL(locale: string): boolean;

    /**
     * Obtains a BreakIterator object for finding the location of break point in text.
     *
     * @syscap SystemCapability.Global.I18n
     * @param locale the returned BreakIterator will adapt the rule, specified by the locale, to break text.
     * @returns Returns a newly constructed BreakIterator object.
     * @since 8
     */
    export function getLineInstance(locale: string): BreakIterator;

    /**
     * The BreakIterator class is used for finding the location of break point in text.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     */
    export class BreakIterator {
        /**
         * Obtains the current position of the BreakIterator instance.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the current position of the BreakIterator instance.
         * @since 8
         */
        current(): number;

        /**
         * Set the BreakIterator's position to the first break point, the first break point is always the beginning of the
         * processed text.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the index of the first break point.
         * @since 8
         */
        first(): number;

        /**
         * Set the BreakIterator's position to the last break point. the last break point is always the index beyond the
         * last character of the processed text.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the index of the last break point.
         * @since 8
         */
        last(): number;

        /**
         * Set the BreakIterator's position to the nth break point from the current break point.
         *
         * @syscap SystemCapability.Global.I18n
         * @param index indicates the number of break points to advance. If index is not given, n is treated as 1.
         * @returns Returns the index of the BreakIterator after moving. If there is not enough break points, returns -1.
         * @since 8
         */
        next(index?: number): number;

        /**
         * Set the BreakIterator's position to the break point preceding the current break point.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the index of the BreakIterator after moving. If there is not enough break points, returns -1.
         * @since 8
         */
        previous(): number;

        /**
         * Set the text to be processed.
         *
         * @syscap SystemCapability.Global.I18n
         * @param text Indicates the text to be processed by the BreakIterator.
         * @since 8
         */
        setLineBreakText(text: string): void;

        /**
         * Set the BreakIterator's position to the first break point following the specified offset.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the index of the BreakIterator after moving. If there is not enough break points, returns -1.
         * @since 8
         */
        following(offset: number): number;

        /**
         * Obtains the text being processed.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns the text that is processed by the BreakIterator.
         * @since 8
         */
        getLineBreakText(): string;

        /**
         * Returns true if the position indicated by the offset is a break point, otherwise false. The BreakIterator's
         * position will be set to the position indicated by the offset if it returns true, otherwise the BreakIterator
         * will be moved to the break point following the offset.
         *
         * @syscap SystemCapability.Global.I18n
         * @param offset The offset to be checked.
         * @returns Returns true if the offset is a break point.
         * @since 8
         */
        isBoundary(offset: number): boolean;
    }

    /**
     * Get IndexUtil object.
     *
     * @syscap SystemCapability.Global.I18n
     * @param locale Indicates a character string containing the locale information, including
     *               the language and optionally the script and region, for the NumberFormat object.
     * @returns Returns IndexUtil object.
     * @since 8
     */
    export function getInstance(locale?: string): IndexUtil;

    /**
     * Sequence text can be grouped under the specified area,
     * and grouping index with different lengths can be specified.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     */
    export class IndexUtil {
        /**
         * Get a list of labels for use as a UI index
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a list of labels
         * @since 8
         */
        getIndexList(): Array<string>;

        /**
         * Add the index characters from a Locale to the index.
         *
         * @syscap SystemCapability.Global.I18n
         * @param locale The locale whose index characters are to be added.
         * @since 8
         */
        addLocale(locale: string): void;

        /**
         * Get corresponding index of the input text.
         *
         * @syscap SystemCapability.Global.I18n
         * @param text input text
         * @since 8
         */
        getIndex(text: string): string;
    }

    /**
     * Provides the API for accessing unicode character properties. For example, determine whether a character is a number.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 8
     * @deprecated since 9
     * @useinstead Unicode
     */
    export class Character {
        /**
         * Determines whether the specified code point is a digit character
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a digit character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isDigit
         */
        isDigit(char: string): boolean;

        /**
         * Determines if the specified character is a space character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a space character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isSpaceChar
         */
        isSpaceChar(char: string): boolean;

        /**
         * Determines if the specified character is a whitespace character
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a whitespace character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isWhitespace
         */
        isWhitespace(char: string): boolean;

        /**
         * Determines if the specified character is a RTL character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a RTL character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isRTL
         */
        isRTL(char: string): boolean;

        /**
         * Determines if the specified character is a Ideographic character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a Ideographic character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isIdeograph
         */
        isIdeograph(char: string): boolean;

        /**
         * Determines if the specified character is a Letter or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a Letter
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isLetter
         */
        isLetter(char: string): boolean;

        /**
         * Determines if the specified character is a LowerCase character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a LowerCase character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isLowerCase
         */
        isLowerCase(char: string): boolean;

        /**
         * Determines if the specified character is a UpperCase character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns true if the character is a UpperCase character
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.isUpperCase
         */
        isUpperCase(char: string): boolean;

        /**
         * Get the general category value of the specified character.
         *
         * @syscap SystemCapability.Global.I18n
         * @param char the character to be tested
         * @returns Returns the general category of the specified character.
         * @since 8
         * @deprecated since 9
         * @useinstead Unicode.getType
         */
        getType(char: string): string;
    }

    /**
     * Provides the API for accessing unicode character properties. For example, determine whether a character is a number.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 9
     */
    export class Unicode {
        /**
         * Determines whether the specified code point is a digit character
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a digit character
         * @since 9
         */
        static isDigit(char: string): boolean;

        /**
         * Determines if the specified character is a space character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a space character
         * @since 9
         */
        static isSpaceChar(char: string): boolean;

        /**
         * Determines if the specified character is a whitespace character
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a whitespace character
         * @since 9
         */
        static isWhitespace(char: string): boolean;

        /**
         * Determines if the specified character is a RTL character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a RTL character
         * @since 9
         */
        static isRTL(char: string): boolean;

        /**
         * Determines if the specified character is a Ideographic character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a Ideographic character
         * @since 9
         */
        static isIdeograph(char: string): boolean;

        /**
         * Determines if the specified character is a Letter or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a Letter
         * @since 9
         */
        static isLetter(char: string): boolean;

        /**
         * Determines if the specified character is a LowerCase character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a LowerCase character
         * @since 9
         */
        static isLowerCase(char: string): boolean;

        /**
         * Determines if the specified character is a UpperCase character or not.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns true if the character is a UpperCase character
         * @since 9
         */
        static isUpperCase(char: string): boolean;

        /**
         * Get the general category value of the specified character.
         *
         * @syscap SystemCapability.Global.I18n
         * @param { string } char - the character to be tested
         * @returns Returns the general category of the specified character.
         * @since 9
         */
        static getType(char: string): string;
    }

    /**
     * check out whether system is 24-hour system.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns a boolean represent whether system is 24-hour system.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.is24HourClock
     */
    export function is24HourClock(): boolean;

    /**
     * set 24-hour system.
     *
     * @permission ohos.permission.UPDATE_CONFIGURATION
     * @syscap SystemCapability.Global.I18n
     * @param option represent the boolean to be set.
     * @returns Returns a boolean represent whether setting 24-hour system success.
     * @since 7
     * @deprecated since 9
     * @useinstead ohos.System.set24HourClock
     */
    export function set24HourClock(option: boolean): boolean;

    /**
     * Add one language to preferred language List.
     *
     * @permission ohos.permission.UPDATE_CONFIGURATION
     * @syscap SystemCapability.Global.I18n
     * @param language the language to be added.
     * @param index the position of preferred language list to be inserted.
     * @returns Returns a boolean represent whether language added success.
     * @since 8
     * @deprecated since 9
     * @useinstead ohos.System.addPreferredLanguage
     */
    export function addPreferredLanguage(language: string, index?: number): boolean;

    /**
     * Remove one language from preferred language list.
     *
     * @permission ohos.permission.UPDATE_CONFIGURATION
     * @syscap SystemCapability.Global.I18n
     * @param index the position of removed language in preferred language list.
     * @returns Returns a boolean represent whether removed success.
     * @since 8
     * @deprecated since 9
     * @useinstead ohos.System.removePreferredLanguage
     */
    export function removePreferredLanguage(index: number): boolean;

    /**
     * Access the system preferred language list.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns a string Array represent the preferred language list.
     * @since 8
     * @deprecated since 9
     * @useinstead ohos.System.getPreferredLanguageList
     */
    export function getPreferredLanguageList(): Array<string>;

    /**
     * Get the first preferred language of system.
     *
     * @syscap SystemCapability.Global.I18n
     * @returns Returns a string represent the first preferred language of system.
     * @since 8
     * @deprecated since 9
     * @useinstead ohos.System.getFirstPreferredLanguage
     */
    export function getFirstPreferredLanguage(): string;

    /**
     * Get the default TimeZone object or the TimeZone object corresponds to zoneID.
     *
     * @syscap SystemCapability.Global.I18n
     * @param zoneID TimeZone ID used to create TimeZone Object.
     * @returns Returns a TimeZone object corresponds to zoneID.
     * @since 7
     */
    export function getTimeZone(zoneID?: string): TimeZone;

    /**
     * Provides the API for accessing TimeZone name, rawOffset and offset information.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 7
     */
    export class TimeZone {
        /**
         * Get the id of the TimeZone object.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string represents the timezone id.
         * @since 7
         */
        getID(): string;

        /**
         * Get the displayName of the TimeZone Object under the locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param locale the locale tag use to display timezone object's name.
         * @param isDST wether consider daylight saving time when display timezone object's name.
         * @returns Returns a string represents the display name.
         * @since 7
         */
        getDisplayName(locale?: string, isDST?: boolean): string;

        /**
         * Get the raw offset of the TimeZone object.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a number represents the raw offset.
         * @since 7
         */
        getRawOffset(): number;

        /**
         * Get the offset of the TimeZone object.
         *
         * @syscap SystemCapability.Global.I18n
         * @param date Indicates a date use to compute offset.
         * @returns Returns a number represents the offset with date.
         * @since 7
         */
        getOffset(date?: number): number;

        /**
         * Get available TimeZone ID list.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string array represents the available TimeZone ID list.
         * @since 9
         */
        static getAvailableIDs(): Array<string>;

        /**
         * Get available Zone City ID list.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string array represents the available Zone City ID list.
         * @since 9
         */
        static getAvailableZoneCityIDs(): Array<string>;

        /**
         * Get City display name in a certain locale.
         *
         * @syscap SystemCapability.Global.I18n
         * @param cityID Zone City ID.
         * @param locale locale used to display city name.
         * @returns Returns a string represents the display name of City in locale.
         * @since 9
         */
        static getCityDisplayName(cityID: string, locale: string): string;

        /**
         * Get TimeZone Object from city ID.
         *
         * @syscap SystemCapability.Global.I18n
         * @param cityID Zone City ID.
         * @returns Returns a TimeZone Object from city ID.
         * @since 9
         */
        static getTimezoneFromCity(cityID: string): TimeZone;
    }

    /**
     * Provides the API for transliterate text from one format to another.
     *
     * @syscap SystemCapability.Global.I18n
     * @since 9
     */
    export class Transliterator {
        /**
         * Get a string array of all available transliterator ids.
         *
         * @syscap SystemCapability.Global.I18n
         * @returns Returns a string array of all available transliterator ids.
         * @since 9
         */
        static getAvailableIDs(): string[];

        /**
         * Get a Transliterator that is specified by id name.
         *
         * @syscap SystemCapability.Global.I18n
         * @param id specified the type of Transliterator. id is formed by source and dest. Transliterator will transliterate
         *           the input string from source format to the dest format. For example, a Simplified Chinese to Latn
         *           Transliterator will transform the text written in Chinese to Latn characters.
         * @returns Returns Transliterator that is specified by id name.
         * @since 9
         */
        static getInstance(id: string): Transliterator;

        /**
         * Transform the input text.
         *
         * @syscap SystemCapability.Global.I18n
         * @param id text to be transliterated.
         * @returns Returns the output text that is transliterated from source format to the dest format.
         * @since 9
         */
        transform(text: string): string;
    }
}
export default i18n;
