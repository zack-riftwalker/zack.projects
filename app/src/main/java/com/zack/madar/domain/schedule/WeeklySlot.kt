package com.zack.madar.domain.schedule

import com.zack.madar.domain.calendar.JalaliDate
import com.zack.madar.domain.calendar.toJalali
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Which weeks a weekly slot runs in. Iranian schools often alternate «هفته‌ی فرد» and «هفته‌ی زوج»,
 * e.g. علوم (3 hours a week) as two sessions one week and one the next.
 */
enum class WeekRepeat { EVERY, ODD, EVEN }

/** One regular session in the weekly timetable: a day, a period (زنگ) and which weeks it runs. */
data class WeeklySlot(val day: DayOfWeek, val period: Int, val repeat: WeekRepeat = WeekRepeat.EVERY)

object SchoolWeek {

    /**
     * Whether [date] falls in an odd («فرد») school week. Weeks run Saturday–Friday and are numbered
     * from the week containing 1 Mehr, which is week 1 (odd). [flip] swaps the two for schools that
     * count the other way round.
     */
    fun isOdd(date: LocalDate, flip: Boolean = false): Boolean {
        val j = date.toJalali()
        val startYear = if (j.month >= 7) j.year else j.year - 1
        val mehrFirst = JalaliDate(startYear, 7, 1).toLocalDate()
        val weeks = ChronoUnit.DAYS.between(weekStart(mehrFirst), weekStart(date)) / 7
        val odd = weeks % 2 == 0L
        return odd != flip
    }

    /** The Saturday that starts [date]'s week. */
    fun weekStart(date: LocalDate): LocalDate =
        date.minusDays(Math.floorMod(date.dayOfWeek.value - DayOfWeek.SATURDAY.value, 7).toLong())

    fun runsOn(slot: WeeklySlot, date: LocalDate, flip: Boolean): Boolean =
        slot.day == date.dayOfWeek && when (slot.repeat) {
            WeekRepeat.EVERY -> true
            WeekRepeat.ODD -> isOdd(date, flip)
            WeekRepeat.EVEN -> !isOdd(date, flip)
        }
}
