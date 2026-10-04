package com.zack.madar.ui

import com.zack.madar.ui.timetable.CellStatus
import com.zack.madar.ui.timetable.forecast
import com.zack.madar.ui.timetable.timetableWeek
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class TimetableModelTest {

    private val state = SampleData.state(dark = false)

    @Test
    fun forecastNumbersUpcomingSessions() {
        // ۷۰۲ (1 prior + 2 held) meets Saturday p2 and Sunday p1; today (Sat 3 Oct) isn't logged yet.
        val upcoming = state.forecast(classId = 2, until = LocalDate.of(2026, 10, 11))
        assertEquals(
            listOf(LocalDate.of(2026, 10, 3) to 4, LocalDate.of(2026, 10, 4) to 5, LocalDate.of(2026, 10, 10) to 6, LocalDate.of(2026, 10, 11) to 7),
            upcoming,
        )
    }

    @Test
    fun forecastSkipsHolidays() {
        // ۹۰۱ meets Monday and Tuesday; Tuesday 13 Oct is a holiday.
        val dates = state.forecast(classId = 4, until = LocalDate.of(2026, 10, 14)).map { it.first }
        assertTrue(LocalDate.of(2026, 10, 13) !in dates)
        assertTrue(LocalDate.of(2026, 10, 12) in dates)
    }

    @Test
    fun weekGridPlacesClassesByDayAndPeriod() {
        val week = state.timetableWeek(state.today)
        assertEquals(LocalDate.of(2026, 10, 3), week.start)
        val saturday = LocalDate.of(2026, 10, 3)
        assertEquals("۷۰۱", week.cells[saturday to 1]!!.single().symbol)
        assertEquals(CellStatus.HELD, week.cells[saturday to 1]!!.single().status)
        assertEquals(4, week.cells[saturday to 2]!!.single().number)
        // Odd week: ۸۰۱'s even-only Sunday slot is off, ۹۰۲'s odd-only Monday slot is on.
        assertTrue(week.cells[LocalDate.of(2026, 10, 4) to 3] == null)
        assertEquals("۹۰۲", week.cells[LocalDate.of(2026, 10, 5) to 2]!!.single().symbol)
        assertTrue(week.clashes.isEmpty())
    }
}
