package com.zack.madar.domain.schedule

import com.zack.madar.domain.calendar.MonthSpan
import java.time.LocalDate

enum class SessionStatus { HELD, CANCELED }

/** The minimum a calculation needs to know about a logged session. */
data class SessionRecord(val id: Long, val date: LocalDate, val status: SessionStatus)

/**
 * How a class meets.
 *
 * @param slots its weekly timetable entries (day, period, odd/even weeks).
 * @param flipParity the school counts odd/even weeks the other way round, see [SchoolWeek.isOdd].
 * @param trackingStart the first day the app is responsible for; earlier scheduled days are never "missed".
 * @param priorSessions sessions already taught before the teacher started using the app.
 */
data class ClassPlan(
    val slots: List<WeeklySlot>,
    val trackingStart: LocalDate,
    val priorSessions: Int,
    val flipParity: Boolean = false,
) {
    /** Regular sessions on [date] by the timetable alone (ignores tracking start and holidays). */
    fun sessionsOn(date: LocalDate): Int = slots.count { SchoolWeek.runsOn(it, date, flipParity) }

    /** Whether the class ever meets on this weekday, in either week. */
    fun meetsOnWeekday(date: LocalDate): Boolean = slots.any { it.day == date.dayOfWeek }
}

enum class SlotState {
    /** Held on a regular day. */
    HELD,

    /** Held on a day the class doesn't normally meet (جبرانی). */
    EXTRA,

    /** A regular day that was explicitly canceled for this class. */
    CANCELED,

    /** A regular day that falls on a holiday for this class's school. */
    DAY_OFF,

    /** A regular day in the past with nothing logged. */
    MISSED,

    /** Today is a regular day and nothing is logged yet. */
    TODAY,

    /** A regular day still ahead. */
    UPCOMING,
}

data class MonthSlot(val date: LocalDate, val state: SlotState)

data class ClassMonthStats(
    val month: MonthSpan,
    val slots: List<MonthSlot>,
    val heldThisMonth: Int,
    val canceledThisMonth: Int,
    /** Sessions still to come this month, including today if it's pending. */
    val remaining: Int,
    val missed: List<LocalDate>,
    val upcoming: List<LocalDate>,
    /** Number of the most recent session held (0 if none yet). */
    val lastSessionNumber: Int,
    val isScheduledToday: Boolean,
    val isLoggedToday: Boolean,
) {
    val nextSessionNumber: Int get() = lastSessionNumber + 1

    /** A session is due today and not logged yet (there may be two on one day). */
    val hasPendingToday: Boolean get() = slots.any { it.state == SlotState.TODAY }

    /** Sessions that make up this month's plan: held + still to come + past days awaiting a log. */
    val plannedThisMonth: Int get() = heldThisMonth + remaining + missed.size
}

object ScheduleCalculator {

    /**
     * Lays out [month] for one class.
     *
     * @param sessions every session logged for the class (any month); used for the running session number.
     * @param daysOff holidays that apply to this class (global ones plus its school's).
     */
    fun monthStats(
        plan: ClassPlan,
        sessions: List<SessionRecord>,
        daysOff: Set<LocalDate>,
        month: MonthSpan,
        today: LocalDate,
    ): ClassMonthStats {
        val byDate = sessions.filter { it.date in month }.groupBy { it.date }
        val slots = mutableListOf<MonthSlot>()

        for (date in month.dates()) {
            val logs = byDate[date].orEmpty()
            val expected = expectedOn(plan, date)
            val held = logs.count { it.status == SessionStatus.HELD }
            val canceled = logs.size - held

            if (expected == 0) {
                // Not a regular day: any held session is a make-up (جبرانی).
                val regularDay = plan.meetsOnWeekday(date)
                repeat(held) { slots += MonthSlot(date, if (regularDay) SlotState.HELD else SlotState.EXTRA) }
                if (held == 0 && canceled > 0) slots += MonthSlot(date, SlotState.CANCELED)
                continue
            }
            val heldRegular = minOf(held, expected)
            val canceledRegular = minOf(canceled, expected - heldRegular)
            val open = expected - heldRegular - canceledRegular
            repeat(heldRegular) { slots += MonthSlot(date, SlotState.HELD) }
            repeat(held - heldRegular) { slots += MonthSlot(date, SlotState.EXTRA) }
            repeat(canceledRegular) { slots += MonthSlot(date, SlotState.CANCELED) }
            val openState = when {
                date in daysOff -> SlotState.DAY_OFF
                date.isBefore(today) -> SlotState.MISSED
                date == today -> SlotState.TODAY
                else -> SlotState.UPCOMING
            }
            repeat(open) { slots += MonthSlot(date, openState) }
        }

        val todayLogs = sessions.filter { it.date == today }
        return ClassMonthStats(
            month = month,
            slots = slots,
            heldThisMonth = slots.count { it.state == SlotState.HELD || it.state == SlotState.EXTRA },
            canceledThisMonth = slots.count { it.state == SlotState.CANCELED },
            remaining = slots.count { it.state == SlotState.TODAY || it.state == SlotState.UPCOMING },
            missed = slots.filter { it.state == SlotState.MISSED }.map { it.date },
            upcoming = slots.filter { it.state == SlotState.TODAY || it.state == SlotState.UPCOMING }.map { it.date },
            lastSessionNumber = plan.priorSessions + sessions.count { it.status == SessionStatus.HELD },
            isScheduledToday = expectedOn(plan, today) > 0 && today !in daysOff,
            isLoggedToday = todayLogs.isNotEmpty(),
        )
    }

    /** Running session number for every held session, in teaching order. */
    fun sessionNumbers(sessions: List<SessionRecord>, priorSessions: Int): Map<Long, Int> =
        sessions.asSequence()
            .filter { it.status == SessionStatus.HELD }
            .sortedWith(compareBy<SessionRecord> { it.date }.thenBy { it.id })
            .mapIndexed { index, s -> s.id to priorSessions + index + 1 }
            .toMap()

    /** Regular sessions the app expects on [date]: the timetable's count, from the tracking start on. */
    fun expectedOn(plan: ClassPlan, date: LocalDate): Int =
        if (date.isBefore(plan.trackingStart)) 0 else plan.sessionsOn(date)

    fun isScheduled(plan: ClassPlan, date: LocalDate): Boolean = expectedOn(plan, date) > 0
}
