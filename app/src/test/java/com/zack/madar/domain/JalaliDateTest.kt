package com.zack.madar.domain

import com.zack.madar.domain.calendar.CalendarKind
import com.zack.madar.domain.calendar.GregorianMonthCalendar
import com.zack.madar.domain.calendar.JalaliDate
import com.zack.madar.domain.calendar.JalaliMonthCalendar
import com.zack.madar.domain.calendar.toJalali
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class JalaliDateTest {

    private val knownPairs = listOf(
        LocalDate.of(2026, 3, 21) to JalaliDate(1405, 1, 1),
        LocalDate.of(2026, 10, 3) to JalaliDate(1405, 7, 11),
        LocalDate.of(2026, 9, 23) to JalaliDate(1405, 7, 1),
        LocalDate.of(2025, 3, 21) to JalaliDate(1404, 1, 1),
        LocalDate.of(2025, 3, 20) to JalaliDate(1403, 12, 30),
        LocalDate.of(2024, 3, 20) to JalaliDate(1403, 1, 1),
        LocalDate.of(2026, 3, 20) to JalaliDate(1404, 12, 29),
        LocalDate.of(2021, 3, 21) to JalaliDate(1400, 1, 1),
        LocalDate.of(2016, 1, 1) to JalaliDate(1394, 10, 11),
        LocalDate.of(1979, 2, 11) to JalaliDate(1357, 11, 22),
        LocalDate.of(2030, 3, 20) to JalaliDate(1408, 12, 30),
    )

    @Test
    fun convertsKnownDatesBothWays() {
        for ((gregorian, jalali) in knownPairs) {
            assertEquals("to jalali $gregorian", jalali, gregorian.toJalali())
            assertEquals("to gregorian $jalali", gregorian, jalali.toLocalDate())
        }
    }

    @Test
    fun roundTripsEveryDayForSixtyYears() {
        var date = LocalDate.of(1990, 1, 1)
        var previous = date.minusDays(1).toJalali()
        while (date.year < 2050) {
            val j = date.toJalali()
            assertEquals(date, j.toLocalDate())
            assertTrue("$j should follow $previous", j > previous)
            if (j.day > 1) {
                assertEquals(previous.copy(day = previous.day + 1), j)
            }
            previous = j
            date = date.plusDays(1)
        }
    }

    @Test
    fun leapYears() {
        assertTrue(JalaliDate.isLeapYear(1399))
        assertTrue(JalaliDate.isLeapYear(1403))
        assertTrue(JalaliDate.isLeapYear(1408))
        assertFalse(JalaliDate.isLeapYear(1404))
        assertFalse(JalaliDate.isLeapYear(1405))
        assertEquals(30, JalaliDate.monthLength(1403, 12))
        assertEquals(29, JalaliDate.monthLength(1404, 12))
    }

    @Test
    fun jalaliMonthSpans() {
        val mehr = JalaliMonthCalendar.monthOf(LocalDate.of(2026, 10, 3))
        assertEquals(CalendarKind.JALALI, mehr.kind)
        assertEquals(1405, mehr.year)
        assertEquals(7, mehr.month)
        assertEquals(LocalDate.of(2026, 9, 23), mehr.first)
        assertEquals(LocalDate.of(2026, 10, 22), mehr.last)
        assertEquals(30, mehr.length)
        assertEquals(20, mehr.daysLeft(LocalDate.of(2026, 10, 3)))

        val esfand = JalaliMonthCalendar.shift(mehr, 5)
        assertEquals(1404 + 1, esfand.year)
        assertEquals(12, esfand.month)

        val shahrivar = JalaliMonthCalendar.shift(mehr, -1)
        assertEquals(6, shahrivar.month)
        assertEquals(31, shahrivar.length)

        val esfand1404 = JalaliMonthCalendar.shift(mehr, -7)
        assertEquals(1404, esfand1404.year)
        assertEquals(12, esfand1404.month)
        assertEquals(LocalDate.of(2026, 2, 20), esfand1404.first)
        assertEquals(LocalDate.of(2026, 3, 20), esfand1404.last)
    }

    @Test
    fun gregorianMonthSpans() {
        val october = GregorianMonthCalendar.monthOf(LocalDate.of(2026, 10, 3))
        assertEquals(LocalDate.of(2026, 10, 1), october.first)
        assertEquals(LocalDate.of(2026, 10, 31), october.last)
        assertEquals(2, GregorianMonthCalendar.shift(october, 4).month)
        assertEquals(2027, GregorianMonthCalendar.shift(october, 4).year)
    }
}
