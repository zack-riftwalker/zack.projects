package com.zack.madar.ui.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.ui.AppState
import com.zack.madar.ui.components.EmptyState
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.MiniElement
import com.zack.madar.ui.components.MonthSwitcher
import com.zack.madar.ui.components.SchoolDot
import com.zack.madar.ui.components.SectionHeader
import com.zack.madar.ui.components.Tag
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.Lab
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimetableScreen(
    state: AppState,
    onOpenClass: (Long) -> Unit,
    onEditClasses: () -> Unit,
) {
    var weekOffset by rememberSaveable { mutableIntStateOf(0) }
    val week = state.timetableWeek(state.today.plusWeeks(weekOffset.toLong()))
    val kind = state.settings.calendar

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = { Text("برنامه‌ی هفتگی") },
                    actions = {
                        if (weekOffset != 0) TextButton(onClick = { weekOffset = 0 }) { Text("این هفته") }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
        ) { padding ->
            if (!state.loaded) return@Scaffold
            if (week.isEmpty && week.periods == 0) {
                EmptyState(
                    title = "هنوز برنامه‌ای نیست",
                    body = "در صفحه‌ی هر کلاس، زنگ‌ها را روی جدول بزن؛ برنامه‌ی هفتگی خودش ساخته می‌شود.",
                    actionLabel = "رفتن به کلاس‌ها",
                    onAction = onEditClasses,
                    modifier = Modifier.padding(padding),
                )
                return@Scaffold
            }
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 12.dp,
                    end = 12.dp,
                    top = padding.calculateTopPadding(),
                    bottom = padding.calculateBottomPadding() + 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "week") {
                    LabCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            MonthSwitcher(
                                title = when (weekOffset) {
                                    0 -> "این هفته"
                                    1 -> "هفته‌ی بعد"
                                    -1 -> "هفته‌ی قبل"
                                    else -> "${PersianFormat.dayMonth(week.days.first(), kind)} تا ${PersianFormat.dayMonth(week.days.last(), kind)}"
                                },
                                onPrevious = { weekOffset-- },
                                onNext = { weekOffset++ },
                            )
                            ParityRow(week)
                            Spacer(Modifier.height(8.dp))
                            WeekGrid(week, state.today, state.calendar::dayOfMonth, onOpenClass)
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "${PersianFormat.digits(week.sessionCount)} جلسه در این هفته" +
                                    if (week.clashes.isNotEmpty()) " · ${PersianFormat.digits(week.clashes.size)} تداخل" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (week.clashes.isNotEmpty()) Lab.colors.canceled else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 6.dp),
                            )
                            GridLegend()
                        }
                    }
                }

                item(key = "plan-header") {
                    SectionHeader(
                        title = "جلسه‌های پیش رو تا آخر ${PersianFormat.monthName(state.month)}",
                        subtitle = "شماره‌ی هر جلسه، اگر همه‌ی جلسه‌های قبلش برگزار شوند",
                    )
                }
                items(state.overviews(), key = { it.id }) { o ->
                    val upcoming = state.forecast(o.id, state.month.last)
                    MonthPlanRow(
                        symbol = o.schoolClass.symbol,
                        name = o.schoolClass.name,
                        colorIndex = o.colorIndex,
                        upcoming = upcoming,
                        today = state.today,
                        onClick = { onOpenClass(o.id) },
                        dateLabel = { PersianFormat.weekdayDayMonth(it, kind) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ParityRow(week: TimetableWeek) {
    if (week.oddBySchool.isEmpty()) return
    FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for ((school, odd) in week.oddBySchool) {
            Tag("${school.name}: هفته‌ی ${if (odd) "فرد" else "زوج"}", schoolColor(school.colorIndex))
        }
    }
}

@Composable
private fun WeekGrid(week: TimetableWeek, today: LocalDate, dayOfMonth: (LocalDate) -> Int, onOpenClass: (Long) -> Unit) {
    val lab = Lab.colors
    val line = MaterialTheme.colorScheme.outlineVariant
    val clashes = week.clashes.toSet()
    Column(Modifier.fillMaxWidth()) {
        // Header: corner + one column per day (Saturday on the right in RTL).
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "زنگ",
                modifier = Modifier.width(34.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            for (date in week.days) {
                val isToday = date == today
                Column(
                    Modifier
                        .weight(1f)
                        .padding(horizontal = 2.dp)
                        .background(
                            if (isToday) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent,
                            RoundedCornerShape(8.dp),
                        )
                        .padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        PersianFormat.weekdayInitial(date.dayOfWeek),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = if (isToday) FontWeight.Black else FontWeight.Medium,
                        color = if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                    )
                    Text(
                        PersianFormat.digits(dayOfMonth(date)),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        for (period in 1..week.periods) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(line))
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    PersianFormat.digits(period),
                    modifier = Modifier.width(34.dp),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                for (date in week.days) {
                    val entries = week.cells[date to period].orEmpty()
                    val clash = (date to period) in clashes
                    Column(
                        Modifier
                            .weight(1f)
                            .padding(2.dp)
                            .heightIn(min = 48.dp)
                            .then(if (clash) Modifier.border(1.5.dp, lab.canceled, RoundedCornerShape(8.dp)) else Modifier),
                        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                    ) {
                        for (e in entries) CellChip(e) { onOpenClass(e.classId) }
                    }
                }
            }
        }
    }
}

@Composable
private fun CellChip(cell: TimetableCell, onClick: () -> Unit) {
    val lab = Lab.colors
    val color = schoolColor(cell.colorIndex)
    val dim = cell.status == CellStatus.DAY_OFF || cell.status == CellStatus.CANCELED
    val description = buildString {
        append(cell.symbol)
        cell.number?.let { append("، جلسه‌ی ").append(PersianFormat.digits(it)) }
        when (cell.status) {
            CellStatus.HELD -> append("، برگزار شد")
            CellStatus.CANCELED -> append("، کنسل")
            CellStatus.DAY_OFF -> append("، تعطیل")
            CellStatus.MISSED -> append("، ثبت نشده")
            CellStatus.UPCOMING -> Unit
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .alpha(if (dim) 0.45f else 1f)
            .background(color.copy(alpha = if (cell.status == CellStatus.HELD) 0.32f else 0.16f), RoundedCornerShape(8.dp))
            .border(1.dp, if (cell.status == CellStatus.MISSED) lab.missed else color.copy(alpha = 0.7f), RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(vertical = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            cell.symbol,
            style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
            fontWeight = FontWeight.Black,
            color = MaterialTheme.colorScheme.onSurface,
            textDecoration = if (dim) TextDecoration.LineThrough else null,
            maxLines = 1,
        )
        val sub = when {
            cell.status == CellStatus.HELD -> "✓"
            cell.status == CellStatus.DAY_OFF -> "تعطیل"
            cell.status == CellStatus.CANCELED -> "کنسل"
            cell.number != null -> "ج${PersianFormat.digits(cell.number)}"
            else -> null
        }
        val badge = when (cell.repeat) {
            WeekRepeat.EVERY -> null
            WeekRepeat.ODD -> "ف"
            WeekRepeat.EVEN -> "ز"
        }
        val line = listOfNotNull(sub, badge).joinToString(" · ")
        if (line.isNotEmpty()) {
            Text(line, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = color, maxLines = 1)
        }
    }
}

@Composable
private fun GridLegend() {
    Text(
        "ج = شماره‌ی جلسه · ✓ = برگزار شد · ف/ز = فقط هفته‌ی فرد/زوج · روی هر خانه بزن تا کلاس باز شود",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MonthPlanRow(
    symbol: String,
    name: String,
    colorIndex: Int,
    upcoming: List<Pair<LocalDate, Int>>,
    today: LocalDate,
    onClick: () -> Unit,
    dateLabel: (LocalDate) -> String,
) {
    val color = schoolColor(colorIndex)
    LabCard(Modifier.fillMaxWidth(), accent = color, onClick = onClick) {
        Row(Modifier.padding(12.dp)) {
            MiniElement(symbol, color, size = 40.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text(
                        "${PersianFormat.digits(upcoming.size)} جلسه مانده",
                        style = MaterialTheme.typography.labelMedium,
                        color = color,
                    )
                }
                if (upcoming.isEmpty()) {
                    Text(
                        "تا آخر ماه جلسه‌ای نمانده",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((date, number) in upcoming) {
                            Row(
                                Modifier
                                    .background(
                                        if (date == today) color.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                                        RoundedCornerShape(50),
                                    )
                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                SchoolDot(color, size = 6.dp)
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "ج${PersianFormat.digits(number)} · ${if (date == today) "امروز" else dateLabel(date)}",
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
