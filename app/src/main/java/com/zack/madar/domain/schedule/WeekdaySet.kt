package com.zack.madar.domain.schedule

import java.time.DayOfWeek

/** Compact set of weekdays, stored as a bitmask (bit 0 = Monday … bit 6 = Sunday). */
@JvmInline
value class WeekdaySet(val bits: Int) {

    operator fun contains(day: DayOfWeek): Boolean = bits and bit(day) != 0

    fun with(day: DayOfWeek): WeekdaySet = WeekdaySet(bits or bit(day))

    fun without(day: DayOfWeek): WeekdaySet = WeekdaySet(bits and bit(day).inv())

    fun toggle(day: DayOfWeek): WeekdaySet = if (day in this) without(day) else with(day)

    val isEmpty: Boolean get() = bits == 0

    val size: Int get() = Integer.bitCount(bits)

    /** Days in Iranian week order (Saturday first). */
    fun days(): List<DayOfWeek> = IRANIAN_WEEK.filter { it in this }

    companion object {
        val NONE = WeekdaySet(0)

        /** Saturday → Friday, the order used in Iranian schools and calendars. */
        val IRANIAN_WEEK: List<DayOfWeek> = listOf(
            DayOfWeek.SATURDAY, DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
            DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY,
        )

        fun of(vararg days: DayOfWeek): WeekdaySet = days.fold(NONE) { set, d -> set.with(d) }

        private fun bit(day: DayOfWeek) = 1 shl (day.value - 1)
    }
}
