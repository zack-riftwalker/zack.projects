package com.zack.madar.domain.format

import com.zack.madar.domain.calendar.CalendarKind
import com.zack.madar.domain.calendar.MonthSpan
import com.zack.madar.domain.calendar.toJalali
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.Locale

/** Persian text helpers: digits, month and weekday names, and date phrases. */
object PersianFormat {

    private const val PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

    val JALALI_MONTHS = listOf(
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
        "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
    )

    val GREGORIAN_MONTHS = listOf(
        "ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن",
        "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر",
    )

    fun digits(value: Int): String = digits(value.toString())

    fun digits(text: String): String = buildString(text.length) {
        for (c in text) append(if (c in '0'..'9') PERSIAN_DIGITS[c - '0'] else c)
    }

    /** Converts Persian and Arabic-Indic digits typed by the user back to ASCII. */
    fun toAsciiDigits(text: String): String = buildString(text.length) {
        for (c in text) {
            append(
                when (c) {
                    in '۰'..'۹' -> '0' + (c - '۰')
                    in '٠'..'٩' -> '0' + (c - '٠')
                    else -> c
                },
            )
        }
    }

    fun weekdayName(day: DayOfWeek): String = when (day) {
        DayOfWeek.SATURDAY -> "شنبه"
        DayOfWeek.SUNDAY -> "یکشنبه"
        DayOfWeek.MONDAY -> "دوشنبه"
        DayOfWeek.TUESDAY -> "سه‌شنبه"
        DayOfWeek.WEDNESDAY -> "چهارشنبه"
        DayOfWeek.THURSDAY -> "پنجشنبه"
        DayOfWeek.FRIDAY -> "جمعه"
    }

    fun weekdayInitial(day: DayOfWeek): String = when (day) {
        DayOfWeek.SATURDAY -> "ش"
        DayOfWeek.SUNDAY -> "ی"
        DayOfWeek.MONDAY -> "د"
        DayOfWeek.TUESDAY -> "س"
        DayOfWeek.WEDNESDAY -> "چ"
        DayOfWeek.THURSDAY -> "پ"
        DayOfWeek.FRIDAY -> "ج"
    }

    fun monthName(span: MonthSpan): String = when (span.kind) {
        CalendarKind.JALALI -> JALALI_MONTHS[span.month - 1]
        CalendarKind.GREGORIAN -> GREGORIAN_MONTHS[span.month - 1]
    }

    /** «مهر ۱۴۰۵» */
    fun monthTitle(span: MonthSpan): String = "${monthName(span)} ${digits(span.year)}"

    /** «۱۱ مهر» */
    fun dayMonth(date: LocalDate, kind: CalendarKind): String = when (kind) {
        CalendarKind.JALALI -> date.toJalali().let { "${digits(it.day)} ${JALALI_MONTHS[it.month - 1]}" }
        CalendarKind.GREGORIAN -> "${digits(date.dayOfMonth)} ${GREGORIAN_MONTHS[date.monthValue - 1]}"
    }

    /** «۱۱ مهر ۱۴۰۵» */
    fun fullDate(date: LocalDate, kind: CalendarKind): String = when (kind) {
        CalendarKind.JALALI -> date.toJalali().let { "${digits(it.day)} ${JALALI_MONTHS[it.month - 1]} ${digits(it.year)}" }
        CalendarKind.GREGORIAN -> "${digits(date.dayOfMonth)} ${GREGORIAN_MONTHS[date.monthValue - 1]} ${digits(date.year)}"
    }

    /** «شنبه ۱۱ مهر» */
    fun weekdayDayMonth(date: LocalDate, kind: CalendarKind): String =
        "${weekdayName(date.dayOfWeek)} ${dayMonth(date, kind)}"

    /** «امروز» / «دیروز» / «فردا», otherwise «شنبه ۱۱ مهر». */
    fun relativeDay(date: LocalDate, today: LocalDate, kind: CalendarKind): String = when (date) {
        today -> "امروز"
        today.minusDays(1) -> "دیروز"
        today.plusDays(1) -> "فردا"
        else -> weekdayDayMonth(date, kind)
    }

    /** «۱۴۰۵/۰۷/۱۱» */
    fun numericDate(date: LocalDate, kind: CalendarKind): String = when (kind) {
        CalendarKind.JALALI -> date.toJalali().let { digits(String.format(Locale.US, "%d/%02d/%02d", it.year, it.month, it.day)) }
        CalendarKind.GREGORIAN -> digits(String.format(Locale.US, "%d/%02d/%02d", date.year, date.monthValue, date.dayOfMonth))
    }
}
