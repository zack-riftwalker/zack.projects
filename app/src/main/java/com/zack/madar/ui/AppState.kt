package com.zack.madar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.prefs.Settings
import com.zack.madar.data.repo.Snapshot
import com.zack.madar.domain.calendar.MonthCalendar
import com.zack.madar.domain.calendar.MonthSpan
import com.zack.madar.domain.schedule.ClassMonthStats
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.ui.theme.Lab
import com.zack.madar.ui.theme.SchoolPalette
import java.time.LocalDate

/** Everything the UI renders from. Screens derive their view of it with the helpers below. */
@Immutable
data class AppState(
    val snapshot: Snapshot = Snapshot(),
    val settings: Settings = Settings(),
    val today: LocalDate = LocalDate.now(),
    val loaded: Boolean = false,
) {
    val calendar: MonthCalendar get() = MonthCalendar.of(settings.calendar)
    val month: MonthSpan get() = calendar.monthOf(today)

    fun overviews(month: MonthSpan = this.month): List<ClassOverview> =
        snapshot.activeClasses
            .sortedWith(compareBy({ snapshot.school(it.schoolId)?.sortOrder ?: Int.MAX_VALUE }, { it.sortOrder }, { it.id }))
            .map { overviewOf(it, month) }

    fun overview(classId: Long, month: MonthSpan = this.month): ClassOverview? =
        snapshot.classes.firstOrNull { it.id == classId }?.let { overviewOf(it, month) }

    private fun overviewOf(c: SchoolClass, month: MonthSpan): ClassOverview {
        val school = snapshot.school(c.schoolId)
        val sessions = snapshot.sessionsOf(c.id)
        val stats = ScheduleCalculator.monthStats(
            plan = snapshot.planOf(c),
            sessions = sessions.map { it.toRecord() },
            daysOff = snapshot.daysOffFor(c.schoolId),
            month = month,
            today = today,
        )
        val held = sessions.filter { it.status == SessionStatus.HELD }
        return ClassOverview(
            schoolClass = c,
            school = school,
            stats = stats,
            lastHeld = held.maxWithOrNull(compareBy<Session> { it.epochDay }.thenBy { it.id }),
            todaySessions = sessions.filter { it.date == today },
        )
    }

    /** Topic ideas for the log sheet: continue this class, or catch up with a sibling class of the same grade. */
    fun topicSuggestions(classId: Long): List<TopicSuggestion> {
        val target = snapshot.classes.firstOrNull { it.id == classId } ?: return emptyList()
        val mine = overview(classId)?.lastHeld
        val out = mutableListOf<TopicSuggestion>()
        if (mine != null && mine.topic.isNotBlank()) {
            out += TopicSuggestion("ادامه‌ی جلسه‌ی قبل", mine.topic, mine.chapter, mine.page)
        }
        if (target.grade.isNotBlank()) {
            snapshot.activeClasses
                .filter { it.id != classId && it.grade == target.grade }
                .mapNotNull { sibling ->
                    snapshot.sessionsOf(sibling.id)
                        .filter { it.status == SessionStatus.HELD && it.topic.isNotBlank() }
                        .maxByOrNull { it.epochDay }
                        ?.let { sibling to it }
                }
                .filter { (_, s) -> mine == null || s.epochDay >= mine.epochDay }
                .sortedByDescending { (_, s) -> s.epochDay }
                .take(3)
                .forEach { (sibling, s) -> out += TopicSuggestion("مثل ${sibling.name}", s.topic, s.chapter, s.page) }
        }
        return out.distinctBy { it.topic }
    }
}

@Immutable
data class ClassOverview(
    val schoolClass: SchoolClass,
    val school: School?,
    val stats: ClassMonthStats,
    val lastHeld: Session?,
    val todaySessions: List<Session>,
) {
    val id: Long get() = schoolClass.id
    val colorIndex: Int get() = school?.colorIndex ?: 0
    val needsAttention: Boolean get() = stats.missed.isNotEmpty() || stats.hasPendingToday
}

data class TopicSuggestion(val label: String, val topic: String, val chapter: String, val page: String)

@Composable
fun schoolColor(colorIndex: Int): Color = SchoolPalette.color(colorIndex, Lab.colors.isDark)
