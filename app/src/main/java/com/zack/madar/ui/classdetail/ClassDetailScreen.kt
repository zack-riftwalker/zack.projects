package com.zack.madar.ui.classdetail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zack.madar.R
import com.zack.madar.data.db.Session
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.ui.AppState
import com.zack.madar.ui.ClassOverview
import com.zack.madar.ui.components.ElementTile
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.OrbitProgress
import com.zack.madar.ui.components.SectionHeader
import com.zack.madar.ui.components.StatReadout
import com.zack.madar.ui.components.Tag
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.Lab
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassDetailScreen(
    state: AppState,
    classId: Long,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onLog: (LocalDate) -> Unit,
    onEditSession: (Session) -> Unit,
    onMarkCanceled: (LocalDate) -> Unit,
) {
    val overview = state.overview(classId)
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "بازگشت")
                        }
                    },
                    title = { Text(overview?.schoolClass?.name.orEmpty()) },
                    actions = {
                        IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = "ویرایش کلاس") }
                        Box {
                            IconButton(onClick = { menuOpen = true }) {
                                Icon(Icons.Filled.MoreVert, contentDescription = "گزینه‌های بیشتر")
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text("حذف کلاس") },
                                    leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                                    onClick = {
                                        menuOpen = false
                                        confirmDelete = true
                                    },
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
            floatingActionButton = {
                if (overview != null) {
                    ExtendedFloatingActionButton(
                        onClick = { onLog(state.today) },
                        icon = { Icon(painterResource(R.drawable.ic_flask), contentDescription = null) },
                        text = { Text("ثبت جلسه") },
                    )
                }
            },
        ) { padding ->
            if (overview == null) return@Scaffold
            ClassDetailContent(state, overview, padding, onLog, onEditSession, onMarkCanceled)
        }
    }

    if (confirmDelete && overview != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("حذف «${overview.schoolClass.name}»؟") },
            text = { Text("همه‌ی جلسه‌های ثبت‌شده‌ی این کلاس هم حذف می‌شوند. تا چند ثانیه بعد می‌توانی برگردانی.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    onDelete()
                }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("انصراف") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ClassDetailContent(
    state: AppState,
    overview: ClassOverview,
    padding: PaddingValues,
    onLog: (LocalDate) -> Unit,
    onEditSession: (Session) -> Unit,
    onMarkCanceled: (LocalDate) -> Unit,
) {
    val color = schoolColor(overview.colorIndex)
    val stats = overview.stats
    val kind = state.settings.calendar
    val sessions = state.snapshot.sessionsOf(overview.id)
    val numbers = remember(sessions) {
        ScheduleCalculator.sessionNumbers(sessions.map { it.toRecord() }, overview.schoolClass.priorSessions)
    }
    val timeline = sessions.sortedWith(compareByDescending<Session> { it.epochDay }.thenByDescending { it.id })
    var chipDate by remember { mutableStateOf<LocalDate?>(null) }

    LazyColumn(
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = padding.calculateTopPadding(),
            bottom = padding.calculateBottomPadding() + 96.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "hero") {
            LabCard(Modifier.fillMaxWidth(), accent = color) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ElementTile(
                            symbol = overview.schoolClass.symbol,
                            name = overview.school?.name.orEmpty(),
                            number = stats.nextSessionNumber,
                            caption = overview.schoolClass.grade.ifBlank { overview.schoolClass.subject },
                            color = color,
                            modifier = Modifier.width(112.dp),
                        )
                        Spacer(Modifier.weight(1f))
                        OrbitProgress(
                            slots = stats.slots.map { it.state },
                            accent = color,
                            value = PersianFormat.digits(stats.remaining),
                            label = "جلسه مانده",
                            description = "${PersianFormat.digits(stats.remaining)} جلسه تا پایان ${PersianFormat.monthName(stats.month)} مانده",
                            modifier = Modifier.size(156.dp),
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        StatReadout(PersianFormat.digits(stats.nextSessionNumber), "جلسه‌ی بعدی", color = color)
                        StatReadout(
                            "${PersianFormat.digits(stats.heldThisMonth)}/${PersianFormat.digits(stats.plannedThisMonth)}",
                            "برگزار شده در ${PersianFormat.monthName(stats.month)}",
                        )
                        StatReadout(PersianFormat.digits(stats.lastSessionNumber), "کل جلسه‌ها")
                    }
                    Spacer(Modifier.height(10.dp))
                    OrbitLegend(color)
                    val weekly = state.snapshot.slotsOf(overview.id).sortedWith(compareBy({ (it.dayOfWeek + 1) % 7 }, { it.period }))
                    if (weekly.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "برنامه: " + weekly.joinToString(" · ") { slot ->
                                "${PersianFormat.weekdayName(slot.day)} زنگ ${PersianFormat.digits(slot.period)}" +
                                    when (slot.repeat) {
                                        WeekRepeat.EVERY -> ""
                                        WeekRepeat.ODD -> " (فرد)"
                                        WeekRepeat.EVEN -> " (زوج)"
                                    }
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        if (stats.missed.isNotEmpty()) {
            item(key = "missed") {
                LabCard(Modifier.fillMaxWidth(), accent = Lab.colors.missed) {
                    Column(Modifier.padding(14.dp)) {
                        Text(
                            "${PersianFormat.digits(stats.missed.size)} جلسه ثبت نشده",
                            style = MaterialTheme.typography.titleSmall,
                            color = Lab.colors.missed,
                        )
                        for (date in stats.missed.sortedDescending()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    PersianFormat.relativeDay(date, state.today, kind),
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = { onMarkCanceled(date) }) { Text("کنسل بود") }
                                FilledTonalButton(onClick = { onLog(date) }) { Text("ثبت") }
                            }
                        }
                    }
                }
            }
        }

        item(key = "last-topic") { LastTopicCard(state, overview, numbers, onLog, onEditSession) }

        item(key = "upcoming") {
            SectionHeader(
                title = "جلسه‌های باقی‌مانده‌ی ${PersianFormat.monthName(stats.month)}",
                subtitle = if (stats.upcoming.isEmpty()) "تا آخر این ماه جلسه‌ای در برنامه نیست" else "روی هر تاریخ بزن تا ثبت یا کنسلش کنی",
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (date in stats.upcoming) {
                    AssistChip(
                        onClick = { chipDate = date },
                        label = {
                            Text(if (date == state.today) "امروز" else PersianFormat.weekdayDayMonth(date, kind))
                        },
                        colors = if (date == state.today) {
                            AssistChipDefaults.assistChipColors(containerColor = color.copy(alpha = 0.18f))
                        } else {
                            AssistChipDefaults.assistChipColors()
                        },
                    )
                }
            }
        }

        item(key = "log-header") {
            SectionHeader(
                title = "دفتر جلسات",
                subtitle = if (overview.schoolClass.priorSessions > 0) {
                    "${PersianFormat.digits(overview.schoolClass.priorSessions)} جلسه پیش از شروع ثبت در مدار"
                } else {
                    null
                },
            )
        }
        if (timeline.isEmpty()) {
            item(key = "log-empty") {
                Text(
                    "هنوز جلسه‌ای ثبت نشده. بعد از هر کلاس، با دکمه‌ی «ثبت جلسه» بنویس تا کجا درس دادی.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(timeline, key = { "s-${it.id}" }) { s ->
            TimelineEntry(
                session = s,
                number = numbers[s.id],
                dateText = PersianFormat.relativeDay(s.date, state.today, kind),
                color = color,
                isLast = s == timeline.last(),
                onClick = { onEditSession(s) },
            )
        }
    }

    chipDate?.let { date ->
        AlertDialog(
            onDismissRequest = { chipDate = null },
            title = { Text(PersianFormat.weekdayDayMonth(date, kind)) },
            text = { Text("این جلسه برگزار شد یا قرار است کنسل شود؟") },
            confirmButton = {
                if (!date.isAfter(state.today)) {
                    TextButton(onClick = {
                        chipDate = null
                        onLog(date)
                    }) { Text("ثبت جلسه") }
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    chipDate = null
                    onMarkCanceled(date)
                }) { Text("کنسل می‌شود", color = MaterialTheme.colorScheme.error) }
            },
        )
    }
}

@Composable
private fun OrbitLegend(accent: Color) {
    val lab = Lab.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        LegendItem("برگزار شد") { Box(Modifier.size(8.dp).background(accent, CircleShape)) }
        LegendItem("مانده") { Box(Modifier.size(8.dp).border(1.5.dp, accent, CircleShape)) }
        LegendItem("ثبت‌نشده") { Box(Modifier.size(8.dp).background(lab.missed, CircleShape)) }
        LegendItem("کنسل") { Text("✕", color = lab.canceled, style = MaterialTheme.typography.labelSmall) }
    }
}

@Composable
private fun LegendItem(label: String, mark: @Composable () -> Unit) {
    Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        mark()
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LastTopicCard(
    state: AppState,
    overview: ClassOverview,
    numbers: Map<Long, Int>,
    onLog: (LocalDate) -> Unit,
    onEditSession: (Session) -> Unit,
) {
    val last = overview.lastHeld
    val color = schoolColor(overview.colorIndex)
    LabCard(Modifier.fillMaxWidth(), onClick = last?.let { { onEditSession(it) } }) {
        Column(Modifier.padding(16.dp)) {
            Text("آخرین مبحث", style = MaterialTheme.typography.labelLarge, color = color)
            Spacer(Modifier.height(4.dp))
            if (last == null) {
                Text("هنوز چیزی ثبت نشده", style = MaterialTheme.typography.titleMedium)
            } else {
                Text(
                    last.topic.ifBlank { "بدون عنوان" },
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    numbers[last.id]?.let { Tag("جلسه‌ی ${PersianFormat.digits(it)}", color) }
                    if (last.chapter.isNotBlank()) Tag("فصل ${PersianFormat.digits(last.chapter)}", MaterialTheme.colorScheme.secondary)
                    if (last.page.isNotBlank()) Tag("صفحه ${PersianFormat.digits(last.page)}", MaterialTheme.colorScheme.tertiary)
                    Text(
                        PersianFormat.relativeDay(last.date, state.today, state.settings.calendar),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (last.notes.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(last.notes, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (overview.stats.hasPendingToday) {
                Spacer(Modifier.height(10.dp))
                FilledTonalButton(onClick = { onLog(state.today) }) { Text("ثبت جلسه‌ی امروز") }
            }
        }
    }
}

@Composable
private fun TimelineEntry(
    session: Session,
    number: Int?,
    dateText: String,
    color: Color,
    isLast: Boolean,
    onClick: () -> Unit,
) {
    val canceled = session.status == SessionStatus.CANCELED
    val nodeColor = if (canceled) Lab.colors.canceled else color
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clickable(onClick = onClick)
            .alpha(if (canceled) 0.7f else 1f),
    ) {
        Column(Modifier.width(40.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(32.dp).background(nodeColor.copy(alpha = 0.16f), CircleShape).border(1.2.dp, nodeColor, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (canceled) "✕" else PersianFormat.digits(number ?: 0),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = nodeColor,
                )
            }
            if (!isLast) {
                Box(Modifier.width(2.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f).padding(bottom = 16.dp)) {
            Text(dateText, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                when {
                    canceled -> "کنسل شد"
                    session.topic.isBlank() -> "بدون عنوان"
                    else -> session.topic
                },
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
            if (session.chapter.isNotBlank() || session.page.isNotBlank()) {
                Text(
                    listOfNotNull(
                        session.chapter.takeIf { it.isNotBlank() }?.let { "فصل ${PersianFormat.digits(it)}" },
                        session.page.takeIf { it.isNotBlank() }?.let { "صفحه ${PersianFormat.digits(it)}" },
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (session.notes.isNotBlank()) {
                Text(session.notes, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
