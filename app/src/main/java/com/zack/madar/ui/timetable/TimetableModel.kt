package com.zack.madar.ui.timetable

import com.zack.madar.data.db.School
import com.zack.madar.domain.schedule.SchoolWeek
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.ui.AppState
import java.time.DayOfWeek
import java.time.LocalDate

enum class CellStatus { UPCOMING, HELD, CANCELED, DAY_OFF, MISSED }

/** One class in one cell of the weekly table. */
data class TimetableCell(
    val classId: Long,
    val symbol: String,
    val colorIndex: Int,
    val repeat: WeekRepeat,
    val status: CellStatus,
    /** The session number this will be (or was), when known. */
    val number: Int?,
)

/** A concrete week (Saturday → Thursday/Friday) laid out as day columns × period rows. */
data class TimetableWeek(
    val start: LocalDate,
    val days: List<LocalDate>,
    val periods: Int,
    val cells: Map<Pair<LocalDate, Int>, List<TimetableCell>>,
    /** Whether each school is in an odd («فرد») week. */
    val oddBySchool: List<Pair<School, Boolean>>,
) {
    val sessionCount: Int get() = cells.values.sumOf { list -> list.count { it.status != CellStatus.DAY_OFF } }
    val clashes: List<Pair<LocalDate, Int>> get() = cells.filter { (_, v) -> v.count { it.status != CellStatus.DAY_OFF } > 1 }.keys.toList()
    val isEmpty: Boolean get() = cells.isEmpty()
}

/**
 * Regular sessions of a class still to come from today through [until], each with the session
 * number it will get if everything before it is held.
 */
fun AppState.forecast(classId: Long, until: LocalDate): List<Pair<LocalDate, Int>> {
    val c = snapshot.classes.firstOrNull { it.id == classId } ?: return emptyList()
    val plan = snapshot.planOf(c)
    val daysOff = snapshot.daysOffFor(c.schoolId)
    val sessions = snapshot.sessionsOf(classId)
    val logsByDate = sessions.groupingBy { it.date }.eachCount()
    var next = c.priorSessions + sessions.count { it.status == SessionStatus.HELD } + 1
    val out = mutableListOf<Pair<LocalDate, Int>>()
    var date = today
    while (!date.isAfter(until)) {
        if (date !in daysOff) {
            val open = ScheduleCalculator.expectedOn(plan, date) - (logsByDate[date] ?: 0)
            repeat(open.coerceAtLeast(0)) { out += date to next++ }
        }
        date = date.plusDays(1)
    }
    return out
}

fun AppState.timetableWeek(anyDayInWeek: LocalDate): TimetableWeek {
    val start = SchoolWeek.weekStart(anyDayInWeek)
    val allSlots = snapshot.slots.filter { s -> snapshot.activeClasses.any { it.id == s.classId } }
    val usesFriday = allSlots.any { it.day == DayOfWeek.FRIDAY }
    val days = (0 until if (usesFriday) 7 else 6).map { start.plusDays(it.toLong()) }
    val periods = allSlots.maxOfOrNull { it.period } ?: 0
    val weekEnd = days.last()

    val cells = HashMap<Pair<LocalDate, Int>, MutableList<TimetableCell>>()
    for (c in snapshot.activeClasses) {
        val school = snapshot.school(c.schoolId)
        val flip = school?.flipParity ?: false
        val daysOff = snapshot.daysOffFor(c.schoolId)
        val upcoming = forecast(c.id, weekEnd).groupBy({ it.first }, { it.second })
        val logs = snapshot.sessionsOf(c.id).groupBy { it.date }

        for (date in days) {
            if (date.isBefore(c.trackingStart)) continue
            val todays = snapshot.slotsOf(c.id)
                .filter { SchoolWeek.runsOn(it.toWeeklySlot(), date, flip) }
                .sortedBy { it.period }
            if (todays.isEmpty()) continue
            val dayLogs = logs[date].orEmpty()
            val held = dayLogs.count { it.status == SessionStatus.HELD }
            val canceled = dayLogs.size - held
            val numbers = upcoming[date].orEmpty()
            todays.forEachIndexed { k, slot ->
                val status = when {
                    k < held -> CellStatus.HELD
                    k < held + canceled -> CellStatus.CANCELED
                    date in daysOff -> CellStatus.DAY_OFF
                    date.isBefore(today) -> CellStatus.MISSED
                    else -> CellStatus.UPCOMING
                }
                val number = if (status == CellStatus.UPCOMING) numbers.getOrNull(k - held - canceled) else null
                cells.getOrPut(date to slot.period) { mutableListOf() } +=
                    TimetableCell(c.id, c.symbol, school?.colorIndex ?: 0, slot.repeat, status, number)
            }
        }
    }
    return TimetableWeek(
        start = start,
        days = days,
        periods = periods,
        cells = cells,
        oddBySchool = snapshot.schools.map { it to SchoolWeek.isOdd(start, it.flipParity) },
    )
}
