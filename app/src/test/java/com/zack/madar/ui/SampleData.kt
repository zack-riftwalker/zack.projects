package com.zack.madar.ui

import com.zack.madar.data.db.ClassSlot
import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.prefs.Settings
import com.zack.madar.data.prefs.ThemeMode
import com.zack.madar.data.repo.Snapshot
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet
import java.time.DayOfWeek.MONDAY
import java.time.DayOfWeek.SATURDAY
import java.time.DayOfWeek.SUNDAY
import java.time.DayOfWeek.TUESDAY
import java.time.LocalDate

/** A realistic teacher: two schools, five classes, 11 Mehr 1405 (Saturday). */
object SampleData {
    val today: LocalDate = LocalDate.of(2026, 10, 3)
    private val mehr1 = LocalDate.of(2026, 9, 23).toEpochDay()

    private fun d(month: Int, day: Int) = LocalDate.of(2026, month, day).toEpochDay()

    val schools = listOf(
        School(1, "دبیرستان فردوسی", colorIndex = 0, weekdays = WeekdaySet.of(SATURDAY, SUNDAY).bits, sortOrder = 0),
        School(2, "مدرسه‌ی سعدی", colorIndex = 1, weekdays = WeekdaySet.of(MONDAY, TUESDAY).bits, sortOrder = 1),
    )

    val classes = listOf(
        SchoolClass(1, 1, "هفتم ۱", "۷۰۱", grade = "هفتم", subject = "علوم تجربی", priorSessions = 1, trackingStartEpochDay = mehr1, sortOrder = 0),
        SchoolClass(2, 1, "هفتم ۲", "۷۰۲", grade = "هفتم", subject = "علوم تجربی", priorSessions = 1, trackingStartEpochDay = mehr1, sortOrder = 1),
        SchoolClass(3, 1, "هشتم ۱", "۸۰۱", grade = "هشتم", subject = "علوم تجربی", trackingStartEpochDay = mehr1, sortOrder = 2),
        SchoolClass(4, 2, "نهم ۱", "۹۰۱", grade = "نهم", subject = "علوم تجربی", trackingStartEpochDay = mehr1, sortOrder = 3),
        SchoolClass(
            5, 2, "نهم ۲", "۹۰۲", grade = "نهم", subject = "علوم تجربی",
            weekdaysOverride = WeekdaySet.of(TUESDAY).bits, trackingStartEpochDay = mehr1, sortOrder = 4,
        ),
    )

    val sessions = listOf(
        Session(1, 1, d(9, 26), topic = "تجربه و تفکر — مشاهده و فرضیه", chapter = "1", page = "6"),
        Session(2, 1, d(9, 27), topic = "اندازه‌گیری در علوم — یکاها", chapter = "2", page = "14"),
        Session(3, 1, d(10, 3), topic = "اندازه‌گیری جرم و حجم تا آخر فعالیت ۳", chapter = "2", page = "19", notes = "تکلیف: تمرین صفحه‌ی ۲۰"),
        Session(4, 2, d(9, 26), topic = "تجربه و تفکر — مشاهده و فرضیه", chapter = "1", page = "6"),
        Session(5, 2, d(9, 27), topic = "اندازه‌گیری در علوم — یکاها", chapter = "2", page = "13"),
        Session(6, 3, d(9, 26), topic = "مخلوط و جداسازی مواد", chapter = "1", page = "4"),
        Session(7, 4, d(9, 28), topic = "مواد و نقش آن‌ها در زندگی", chapter = "1", page = "3"),
        Session(8, 4, d(9, 29), topic = "جدول تناوبی — گروه‌ها و دوره‌ها", chapter = "1", page = "8"),
        Session(9, 5, d(9, 29), status = SessionStatus.CANCELED, notes = "اردوی مدرسه"),
    )

    val daysOff = listOf(DayOff(1, d(10, 13), null, "تعطیل رسمی"))

    private var slotId = 0L
    private fun slot(classId: Long, day: java.time.DayOfWeek, period: Int, repeat: WeekRepeat = WeekRepeat.EVERY) =
        ClassSlot(++slotId, classId, day.value, period, repeat)

    val slots = listOf(
        slot(1, SATURDAY, 1), slot(1, SUNDAY, 2),
        slot(2, SATURDAY, 2), slot(2, SUNDAY, 1),
        slot(3, SATURDAY, 3), slot(3, SUNDAY, 3, WeekRepeat.EVEN),
        slot(4, MONDAY, 1), slot(4, TUESDAY, 2),
        slot(5, TUESDAY, 1), slot(5, MONDAY, 2, WeekRepeat.ODD),
    )

    fun state(dark: Boolean) = AppState(
        snapshot = Snapshot(schools, classes, sessions, daysOff, slots),
        settings = Settings(theme = if (dark) ThemeMode.DARK else ThemeMode.LIGHT),
        today = today,
        loaded = true,
    )

    fun empty(dark: Boolean) = AppState(
        settings = Settings(theme = if (dark) ThemeMode.DARK else ThemeMode.LIGHT),
        today = today,
        loaded = true,
    )
}
