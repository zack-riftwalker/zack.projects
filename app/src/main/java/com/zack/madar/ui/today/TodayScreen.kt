package com.zack.madar.ui.today

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zack.madar.R
import com.zack.madar.data.db.School
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.ui.AppState
import com.zack.madar.ui.ClassOverview
import com.zack.madar.ui.components.EmptyState
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.MiniElement
import com.zack.madar.ui.components.SchoolDot
import com.zack.madar.ui.components.SectionHeader
import com.zack.madar.ui.components.StatReadout
import com.zack.madar.ui.components.Tag
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.Lab
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    state: AppState,
    onOpenClass: (Long) -> Unit,
    onLog: (classId: Long, date: LocalDate) -> Unit,
    onEditToday: (ClassOverview) -> Unit,
    onMarkCanceled: (classId: Long, date: LocalDate) -> Unit,
    onAddSchool: () -> Unit,
    onAddClass: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val overviews = state.overviews()
    val todays = overviews.filter { it.stats.isScheduledToday || it.todaySessions.isNotEmpty() }
    val missed = overviews.flatMap { o -> o.stats.missed.map { o to it } }.sortedByDescending { it.second }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                painterResource(R.drawable.ic_atom),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(26.dp),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text("مدار", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                        }
                    },
                    actions = {
                        IconButton(onClick = onOpenSettings) {
                            Icon(Icons.Filled.Settings, contentDescription = "تنظیمات")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
        ) { padding ->
            if (!state.loaded) return@Scaffold
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = padding.calculateTopPadding(),
                    bottom = padding.calculateBottomPadding() + 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "hero") { HeroCard(state, overviews) }

                when {
                    state.snapshot.schools.isEmpty() -> item(key = "welcome") {
                        EmptyState(
                            title = "به مدار خوش اومدی",
                            body = "اول مدرسه‌هات رو اضافه کن و بگو چه روزهایی اونجایی. " +
                                "بعد کلاس‌ها رو بساز؛ مدار خودش جلسه‌های باقی‌مونده تا آخر ماه رو می‌شمره.",
                            actionLabel = "افزودن اولین مدرسه",
                            onAction = onAddSchool,
                        )
                    }
                    overviews.isEmpty() -> item(key = "no-classes") {
                        EmptyState(
                            title = "حالا نوبت کلاس‌هاست",
                            body = "می‌تونی چند کلاس رو یک‌جا اضافه کنی؛ روزهاشون از مدرسه ارث می‌برن.",
                            actionLabel = "افزودن کلاس",
                            onAction = onAddClass,
                        )
                    }
                    else -> {
                        item(key = "today-header") {
                            SectionHeader(
                                title = "کلاس‌های امروز",
                                subtitle = todaySubtitle(todays),
                            )
                        }
                        if (todays.isEmpty()) {
                            item(key = "free-day") { FreeDayCard(state) }
                        } else {
                            items(todays, key = { "today-${it.id}" }) { o ->
                                TodayClassCard(
                                    overview = o,
                                    onOpen = { onOpenClass(o.id) },
                                    onLog = { onLog(o.id, state.today) },
                                    onEdit = { onEditToday(o) },
                                )
                            }
                        }

                        if (missed.isNotEmpty()) {
                            item(key = "missed-header") {
                                SectionHeader(
                                    title = "جا مونده از ثبت",
                                    subtitle = "این جلسه‌ها برنامه داشتن ولی هنوز ثبت نشدن",
                                )
                            }
                            items(missed, key = { (o, d) -> "missed-${o.id}-${d.toEpochDay()}" }) { (o, date) ->
                                MissedRow(
                                    overview = o,
                                    dateText = PersianFormat.relativeDay(date, state.today, state.settings.calendar),
                                    onLog = { onLog(o.id, date) },
                                    onCanceled = { onMarkCanceled(o.id, date) },
                                )
                            }
                        }

                        item(key = "schools-header") {
                            SectionHeader(title = "مدرسه‌ها در ${PersianFormat.monthName(state.month)}")
                        }
                        items(state.snapshot.schools, key = { "school-${it.id}" }) { school ->
                            SchoolMonthCard(school, overviews.filter { it.schoolClass.schoolId == school.id })
                        }
                    }
                }
            }
        }
    }
}

private fun todaySubtitle(todays: List<ClassOverview>): String? {
    if (todays.isEmpty()) return null
    val pending = todays.count { !it.stats.isLoggedToday }
    val schools = todays.mapNotNull { it.school?.name }.distinct().joinToString("، ")
    val status = if (pending == 0) "همه ثبت شد ✓" else "${PersianFormat.digits(pending)} کلاس منتظر ثبت"
    return "$schools · $status"
}

@Composable
private fun HeroCard(state: AppState, overviews: List<ClassOverview>) {
    val month = state.month
    val daysLeft = month.daysLeft(state.today)
    val remaining = overviews.sumOf { it.stats.remaining }
    val held = overviews.sumOf { it.stats.heldThisMonth }
    val missed = overviews.sumOf { it.stats.missed.size }
    val kind = state.settings.calendar

    LabCard(Modifier.fillMaxWidth(), accent = MaterialTheme.colorScheme.primary) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        PersianFormat.weekdayName(state.today.dayOfWeek),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        PersianFormat.fullDate(state.today, kind),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(6.dp))
                    Tag(
                        "${PersianFormat.digits(daysLeft)} روز تا پایان ${PersianFormat.monthName(month)}",
                        MaterialTheme.colorScheme.secondary,
                    )
                }
                DayRing(
                    progress = 1f - (daysLeft - 1).toFloat() / month.length,
                    value = PersianFormat.digits(state.calendar.dayOfMonth(state.today)),
                    label = "از ${PersianFormat.digits(month.length)}",
                    modifier = Modifier.size(92.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatReadout(PersianFormat.digits(remaining), "جلسه مانده\nتا آخر ماه", color = MaterialTheme.colorScheme.primary)
                StatReadout(PersianFormat.digits(held), "برگزار شده\nاین ماه", color = Lab.colors.held)
                StatReadout(
                    PersianFormat.digits(missed),
                    "ثبت‌نشده",
                    color = if (missed > 0) Lab.colors.missed else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** How far through the month we are, as a ring with ticks — like a lab gauge. */
@Composable
private fun DayRing(progress: Float, value: String, label: String, modifier: Modifier = Modifier) {
    val track = MaterialTheme.colorScheme.outlineVariant
    val accent = MaterialTheme.colorScheme.primary
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 7.dp.toPx()
            val inset = stroke / 2 + 2.dp.toPx()
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            drawArc(track, 135f, 270f, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            drawArc(
                accent,
                135f,
                270f * progress.coerceIn(0f, 1f),
                false,
                Offset(inset, inset),
                arcSize,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TodayClassCard(overview: ClassOverview, onOpen: () -> Unit, onLog: () -> Unit, onEdit: () -> Unit) {
    val color = schoolColor(overview.colorIndex)
    val c = overview.schoolClass
    val logged = overview.todaySessions.firstOrNull()
    LabCard(Modifier.fillMaxWidth(), accent = color, onClick = onOpen) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniElement(c.symbol, color, size = 52.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(c.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val number = if (logged != null) overview.stats.lastSessionNumber else overview.stats.nextSessionNumber
                Text(
                    "جلسه‌ی ${PersianFormat.digits(number)} · ${overview.school?.name.orEmpty()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val topic = logged?.topic?.takeIf { it.isNotBlank() } ?: overview.lastHeld?.topic
                if (!topic.isNullOrBlank()) {
                    Text(
                        (if (logged != null) "امروز: " else "قبلی: ") + topic,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            if (logged != null) {
                TextButton(onClick = onEdit) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Lab.colors.held, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (logged.status == SessionStatus.CANCELED) "کنسل" else "ثبت شد", color = Lab.colors.held)
                }
            } else {
                FilledTonalButton(onClick = onLog) { Text("ثبت") }
            }
        }
    }
}

@Composable
private fun MissedRow(overview: ClassOverview, dateText: String, onLog: () -> Unit, onCanceled: () -> Unit) {
    val color = schoolColor(overview.colorIndex)
    LabCard(Modifier.fillMaxWidth(), accent = Lab.colors.missed) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniElement(overview.schoolClass.symbol, color, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(overview.schoolClass.name, style = MaterialTheme.typography.titleSmall)
                Text(dateText, style = MaterialTheme.typography.bodySmall, color = Lab.colors.missed)
            }
            TextButton(onClick = onCanceled) { Text("کنسل بود") }
            FilledTonalButton(onClick = onLog, contentPadding = PaddingValues(horizontal = 16.dp)) { Text("ثبت") }
        }
    }
}

@Composable
private fun FreeDayCard(state: AppState) {
    val next = nextTeachingDay(state)
    LabCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Text("امروز کلاس نداری ☕", style = MaterialTheme.typography.titleMedium)
            Text(
                if (next != null) {
                    val (date, classes) = next
                    "کلاس بعدی: ${PersianFormat.relativeDay(date, state.today, state.settings.calendar)} · " +
                        "${PersianFormat.digits(classes.size)} کلاس"
                } else {
                    "در سه هفته‌ی آینده کلاسی در برنامه نیست."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun nextTeachingDay(state: AppState): Pair<LocalDate, List<Long>>? {
    val snapshot = state.snapshot
    for (offset in 1L..21L) {
        val date = state.today.plusDays(offset)
        val classes = snapshot.activeClasses.filter { c ->
            ScheduleCalculator.isScheduled(c.plan(snapshot.school(c.schoolId)), date) &&
                date !in snapshot.daysOffFor(c.schoolId)
        }
        if (classes.isNotEmpty()) return date to classes.map { it.id }
    }
    return null
}

@Composable
private fun SchoolMonthCard(school: School, classes: List<ClassOverview>) {
    val color = schoolColor(school.colorIndex)
    val held = classes.sumOf { it.stats.heldThisMonth }
    val planned = classes.sumOf { it.stats.plannedThisMonth }
    val remaining = classes.sumOf { it.stats.remaining }
    LabCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SchoolDot(color, size = 12.dp)
                Spacer(Modifier.width(8.dp))
                Text(school.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Text(
                    school.weekdaySet.days().joinToString(" · ") { PersianFormat.weekdayName(it) },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { if (planned == 0) 0f else held.toFloat() / planned },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = color,
                trackColor = color.copy(alpha = 0.15f),
                strokeCap = StrokeCap.Round,
                gapSize = 0.dp,
                drawStopIndicator = {},
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "${PersianFormat.digits(classes.size)} کلاس · ${PersianFormat.digits(held)} از ${PersianFormat.digits(planned)} جلسه برگزار شده · " +
                    "${PersianFormat.digits(remaining)} مانده",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
