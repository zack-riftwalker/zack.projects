package com.zack.madar.domain

import com.zack.madar.domain.calendar.JalaliMonthCalendar
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.ClassPlan
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionRecord
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.domain.schedule.SlotState
import com.zack.madar.domain.schedule.WeekdaySet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek.SATURDAY
import java.time.DayOfWeek.TUESDAY
import java.time.LocalDate

/**
 * Mehr 1405 runs 2026-09-23 … 2026-10-22. A Saturday/Tuesday class meets on
 * Sep 26, Sep 29, Oct 3, Oct 6, Oct 10, Oct 13, Oct 17, Oct 20.
 */
class ScheduleCalculatorTest {

    private val today = LocalDate.of(2026, 10, 3) // Saturday, 11 Mehr 1405
    private val mehr = JalaliMonthCalendar.monthOf(today)
    private val plan = ClassPlan(
        weekdays = WeekdaySet.of(SATURDAY, TUESDAY),
        trackingStart = LocalDate.of(2026, 9, 23),
        priorSessions = 3,
    )
    private var nextId = 1L

    private fun held(month: Int, day: Int) =
        SessionRecord(nextId++, LocalDate.of(2026, month, day), SessionStatus.HELD)

    private fun canceled(month: Int, day: Int) =
        SessionRecord(nextId++, LocalDate.of(2026, month, day), SessionStatus.CANCELED)

    @Test
    fun countsRemainingIncludingPendingToday() {
        val stats = ScheduleCalculator.monthStats(plan, listOf(held(9, 26), held(9, 29)), emptySet(), mehr, today)

        assertEquals(2, stats.heldThisMonth)
        assertEquals(6, stats.remaining)
        assertEquals(8, stats.plannedThisMonth)
        assertTrue(stats.missed.isEmpty())
        assertEquals(5, stats.lastSessionNumber)
        assertEquals(6, stats.nextSessionNumber)
        assertTrue(stats.isScheduledToday)
        assertFalse(stats.isLoggedToday)
        assertEquals(SlotState.TODAY, stats.slots.single { it.date == today }.state)
        assertEquals(LocalDate.of(2026, 10, 20), stats.upcoming.last())
    }

    @Test
    fun loggingTodayRemovesItFromRemaining() {
        val stats = ScheduleCalculator.monthStats(
            plan, listOf(held(9, 26), held(9, 29), held(10, 3)), emptySet(), mehr, today,
        )
        assertEquals(3, stats.heldThisMonth)
        assertEquals(5, stats.remaining)
        assertTrue(stats.isLoggedToday)
        assertEquals(6, stats.lastSessionNumber)
    }

    @Test
    fun holidaysAndCancellationsAreNotCounted() {
        val stats = ScheduleCalculator.monthStats(
            plan,
            listOf(held(9, 26), held(9, 29), canceled(10, 10)),
            daysOff = setOf(LocalDate.of(2026, 10, 13)),
            month = mehr,
            today = today,
        )
        assertEquals(4, stats.remaining)
        assertEquals(1, stats.canceledThisMonth)
        assertEquals(SlotState.DAY_OFF, stats.slots.single { it.date == LocalDate.of(2026, 10, 13) }.state)
        assertEquals(SlotState.CANCELED, stats.slots.single { it.date == LocalDate.of(2026, 10, 10) }.state)
    }

    @Test
    fun holidayTodayIsNotScheduledToday() {
        val stats = ScheduleCalculator.monthStats(plan, emptyList(), setOf(today), mehr, today)
        assertFalse(stats.isScheduledToday)
    }

    @Test
    fun pastDaysWithoutLogsAreMissed() {
        val stats = ScheduleCalculator.monthStats(plan, listOf(held(9, 26)), emptySet(), mehr, today)
        assertEquals(listOf(LocalDate.of(2026, 9, 29)), stats.missed)
        assertEquals(8, stats.plannedThisMonth)
    }

    @Test
    fun daysBeforeTrackingStartAreIgnored() {
        val lateStart = plan.copy(trackingStart = LocalDate.of(2026, 10, 1))
        val stats = ScheduleCalculator.monthStats(lateStart, emptyList(), emptySet(), mehr, today)
        assertTrue(stats.missed.isEmpty())
        assertEquals(6, stats.plannedThisMonth)
    }

    @Test
    fun sessionOnOffDayCountsAsExtra() {
        val thursday = held(10, 1)
        val stats = ScheduleCalculator.monthStats(plan, listOf(held(9, 26), held(9, 29), thursday), emptySet(), mehr, today)
        assertEquals(3, stats.heldThisMonth)
        assertEquals(SlotState.EXTRA, stats.slots.single { it.date == thursday.date }.state)
        assertEquals(6, stats.remaining)
    }

    @Test
    fun futureMonthIsAllUpcoming() {
        val aban = JalaliMonthCalendar.shift(mehr, 1)
        val stats = ScheduleCalculator.monthStats(plan, emptyList(), emptySet(), aban, today)
        assertEquals(stats.plannedThisMonth, stats.remaining)
        assertTrue(stats.remaining >= 8)
    }

    @Test
    fun sessionNumbersFollowTeachingOrder() {
        val a = SessionRecord(10, LocalDate.of(2026, 9, 29), SessionStatus.HELD)
        val b = SessionRecord(4, LocalDate.of(2026, 9, 26), SessionStatus.HELD)
        val c = SessionRecord(7, LocalDate.of(2026, 9, 27), SessionStatus.CANCELED)
        val numbers = ScheduleCalculator.sessionNumbers(listOf(a, b, c), priorSessions = 3)
        assertEquals(mapOf(4L to 4, 10L to 5), numbers)
    }

    @Test
    fun persianFormatting() {
        assertEquals("۱۴۰۵", PersianFormat.digits(1405))
        assertEquals("مهر ۱۴۰۵", PersianFormat.monthTitle(mehr))
        assertEquals("۱۱ مهر ۱۴۰۵", PersianFormat.fullDate(today, mehr.kind))
        assertEquals("۱۴۰۵/۰۷/۱۱", PersianFormat.numericDate(today, mehr.kind))
        assertEquals("امروز", PersianFormat.relativeDay(today, today, mehr.kind))
        assertEquals("سه‌شنبه ۱۴ مهر", PersianFormat.relativeDay(LocalDate.of(2026, 10, 6), today, mehr.kind))
        assertEquals("12", PersianFormat.toAsciiDigits("۱۲"))
    }
}
