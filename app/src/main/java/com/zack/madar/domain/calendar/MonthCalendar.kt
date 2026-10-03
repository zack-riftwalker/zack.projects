package com.zack.madar.domain.calendar

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

enum class CalendarKind { JALALI, GREGORIAN }

/** One month of the active calendar, expressed as an inclusive range of ISO dates. */
data class MonthSpan(
    val kind: CalendarKind,
    val year: Int,
    val month: Int,
    val first: LocalDate,
    val last: LocalDate,
) {
    val length: Int get() = (last.toEpochDay() - first.toEpochDay() + 1).toInt()

    operator fun contains(date: LocalDate): Boolean = !date.isBefore(first) && !date.isAfter(last)

    fun dates(): Sequence<LocalDate> = generateSequence(first) { it.plusDays(1) }.takeWhile { !it.isAfter(last) }

    /** Days left in the month counting [today] itself; 0 once the month is over. */
    fun daysLeft(today: LocalDate): Int = when {
        today.isAfter(last) -> 0
        today.isBefore(first) -> length
        else -> (last.toEpochDay() - today.toEpochDay() + 1).toInt()
    }
}

/** Month arithmetic for the calendar the teacher works with. */
interface MonthCalendar {
    val kind: CalendarKind

    /** First day of the week as shown in month grids. */
    val weekStart: DayOfWeek

    fun monthOf(date: LocalDate): MonthSpan

    fun shift(span: MonthSpan, months: Int): MonthSpan

    /** Day-of-month number of [date] in this calendar. */
    fun dayOfMonth(date: LocalDate): Int

    companion object {
        fun of(kind: CalendarKind): MonthCalendar = when (kind) {
            CalendarKind.JALALI -> JalaliMonthCalendar
            CalendarKind.GREGORIAN -> GregorianMonthCalendar
        }
    }
}

object JalaliMonthCalendar : MonthCalendar {
    override val kind = CalendarKind.JALALI
    override val weekStart: DayOfWeek = DayOfWeek.SATURDAY

    override fun monthOf(date: LocalDate): MonthSpan {
        val j = date.toJalali()
        return span(j.year, j.month)
    }

    override fun shift(span: MonthSpan, months: Int): MonthSpan {
        val index = span.year * 12 + (span.month - 1) + months
        return span(Math.floorDiv(index, 12), Math.floorMod(index, 12) + 1)
    }

    override fun dayOfMonth(date: LocalDate): Int = date.toJalali().day

    private fun span(year: Int, month: Int): MonthSpan {
        val first = JalaliDate(year, month, 1).toLocalDate()
        val last = first.plusDays(JalaliDate.monthLength(year, month) - 1L)
        return MonthSpan(kind, year, month, first, last)
    }
}

object GregorianMonthCalendar : MonthCalendar {
    override val kind = CalendarKind.GREGORIAN
    override val weekStart: DayOfWeek = DayOfWeek.SATURDAY

    override fun monthOf(date: LocalDate): MonthSpan = span(YearMonth.from(date))

    override fun shift(span: MonthSpan, months: Int): MonthSpan =
        span(YearMonth.of(span.year, span.month).plusMonths(months.toLong()))

    override fun dayOfMonth(date: LocalDate): Int = date.dayOfMonth

    private fun span(ym: YearMonth) =
        MonthSpan(kind, ym.year, ym.monthValue, ym.atDay(1), ym.atEndOfMonth())
}
