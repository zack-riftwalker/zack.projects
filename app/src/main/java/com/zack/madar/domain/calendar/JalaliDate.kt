package com.zack.madar.domain.calendar

import java.time.LocalDate

/**
 * A date in the Solar Hijri (Jalali / شمسی) calendar.
 *
 * Conversion follows the arithmetic of the widely used `jalaali-js` library
 * (Borkowski's 33-year cycle with the table of break years), which matches the
 * official Iranian calendar for 1178–3177 AP.
 */
data class JalaliDate(val year: Int, val month: Int, val day: Int) : Comparable<JalaliDate> {

    init {
        require(month in 1..12) { "Invalid Jalali month: $month" }
        require(day in 1..monthLength(year, month)) { "Invalid Jalali day: $year/$month/$day" }
    }

    fun toLocalDate(): LocalDate {
        val r = jalCal(year)
        val farvardinFirst = LocalDate.of(r.gregorianYear, 3, r.march).toEpochDay()
        val offset = (month - 1) * 31 - (month / 7) * (month - 7) + day - 1
        return LocalDate.ofEpochDay(farvardinFirst + offset)
    }

    override fun compareTo(other: JalaliDate): Int =
        compareValuesBy(this, other, JalaliDate::year, JalaliDate::month, JalaliDate::day)

    companion object {
        private val BREAKS = intArrayOf(
            -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
            1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
        )

        fun of(date: LocalDate): JalaliDate {
            val gy = date.year
            var jy = gy - 621
            val r = jalCal(jy)
            val farvardinFirst = LocalDate.of(gy, 3, r.march).toEpochDay()
            var k = (date.toEpochDay() - farvardinFirst).toInt()
            if (k >= 0) {
                if (k <= 185) return JalaliDate(jy, 1 + k / 31, k % 31 + 1)
                k -= 186
            } else {
                jy -= 1
                k += 179
                if (r.leap == 1) k += 1
            }
            return JalaliDate(jy, 7 + k / 30, k % 30 + 1)
        }

        fun isLeapYear(year: Int): Boolean = jalCal(year).leap == 0

        fun monthLength(year: Int, month: Int): Int = when {
            month <= 6 -> 31
            month <= 11 -> 30
            isLeapYear(year) -> 30
            else -> 29
        }

        private class YearInfo(val leap: Int, val gregorianYear: Int, val march: Int)

        /** Port of `jalCal` from jalaali-js: leap state and the March day of Nowruz for [jy]. */
        private fun jalCal(jy: Int): YearInfo {
            val gy = jy + 621
            var leapJ = -14
            var jp = BREAKS[0]
            require(jy >= jp && jy < BREAKS.last()) { "Jalali year out of range: $jy" }

            var jump = 0
            for (i in 1 until BREAKS.size) {
                val jm = BREAKS[i]
                jump = jm - jp
                if (jy < jm) break
                leapJ += jump / 33 * 8 + (jump % 33) / 4
                jp = jm
            }
            var n = jy - jp
            leapJ += n / 33 * 8 + (n % 33 + 3) / 4
            if (jump % 33 == 4 && jump - n == 4) leapJ += 1

            val leapG = gy / 4 - (gy / 100 + 1) * 3 / 4 - 150
            val march = 20 + leapJ - leapG

            if (jump - n < 6) n = n - jump + (jump + 4) / 33 * 33
            var leap = ((n + 1) % 33 - 1) % 4
            if (leap == -1) leap = 4
            return YearInfo(leap, gy, march)
        }
    }
}

fun LocalDate.toJalali(): JalaliDate = JalaliDate.of(this)
