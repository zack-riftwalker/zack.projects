package com.zack.madar.data.db

import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet

/**
 * Builds timetable slots for data saved before periods existed (schema v1, backup v1), where a class
 * only had weekdays — its own override or its school's. Classes of a school that share a day get
 * consecutive periods in their list order, which the teacher can then correct on the timetable.
 */
object LegacySlots {

    data class LegacyClass(val id: Long, val schoolId: Long, val weekdaysOverride: Int?, val sortOrder: Int)

    fun derive(schoolWeekdays: Map<Long, Int>, classes: List<LegacyClass>): List<ClassSlot> {
        val nextPeriod = HashMap<Pair<Long, Int>, Int>()
        return classes
            .sortedWith(compareBy({ it.sortOrder }, { it.id }))
            .flatMap { c ->
                val days = WeekdaySet(c.weekdaysOverride ?: schoolWeekdays[c.schoolId] ?: 0).days()
                days.map { day ->
                    val key = c.schoolId to day.value
                    val period = (nextPeriod[key] ?: 0) + 1
                    nextPeriod[key] = period
                    ClassSlot(classId = c.id, dayOfWeek = day.value, period = period, repeat = WeekRepeat.EVERY)
                }
            }
    }
}
