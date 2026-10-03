package com.zack.madar.domain.schedule

import com.zack.madar.domain.calendar.MonthSpan
import java.time.LocalDate

enum class SessionStatus { HELD, CANCELED }

/** The minimum a calculation needs to know about a logged session. */
data class SessionRecord(val id: Long, val date: LocalDate, val status: SessionStatus)

/**
 * How a class meets.
 *
 * @param weekdays the days the class normally meets (inherited from its school unless overridden).
 * @param trackingStart the first day the app is responsible for; earlier scheduled days are never "missed".
 * @param priorSessions sessions already taught before the teacher started using the app.
 */
data class ClassPlan(
    val weekdays: WeekdaySet,
    val trackingStart: LocalDate,
    val priorSessions: Int,
)

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
            val scheduled = isScheduled(plan, date)
            val held = logs.count { it.status == SessionStatus.HELD }
            when {
                held > 0 -> repeat(held) {
                    val regularDay = date.dayOfWeek in plan.weekdays
                    slots += MonthSlot(date, if (regularDay) SlotState.HELD else SlotState.EXTRA)
                }
                logs.isNotEmpty() -> slots += MonthSlot(date, SlotState.CANCELED)
                !scheduled -> Unit
                date in daysOff -> slots += MonthSlot(date, SlotState.DAY_OFF)
                date.isBefore(today) -> slots += MonthSlot(date, SlotState.MISSED)
                date == today -> slots += MonthSlot(date, SlotState.TODAY)
                else -> slots += MonthSlot(date, SlotState.UPCOMING)
            }
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
            isScheduledToday = isScheduled(plan, today) && today !in daysOff,
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

    fun isScheduled(plan: ClassPlan, date: LocalDate): Boolean =
        date.dayOfWeek in plan.weekdays && !date.isBefore(plan.trackingStart)
}
