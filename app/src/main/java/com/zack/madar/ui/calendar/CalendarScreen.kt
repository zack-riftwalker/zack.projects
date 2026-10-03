package com.zack.madar.ui.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.SlotState
import com.zack.madar.ui.AppState
import com.zack.madar.ui.ClassOverview
import com.zack.madar.ui.components.DayMarks
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.MiniElement
import com.zack.madar.ui.components.MonthGrid
import com.zack.madar.ui.components.MonthSwitcher
import com.zack.madar.ui.components.SchoolDot
import com.zack.madar.ui.components.SectionHeader
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.Lab
import com.zack.madar.ui.theme.SchoolPalette
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    state: AppState,
    onOpenClass: (Long) -> Unit,
    onLog: (classId: Long, date: LocalDate) -> Unit,
    onToggleDayOff: (date: LocalDate, schoolId: Long?) -> Unit,
) {
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var selectedDay by rememberSaveable { mutableLongStateOf(state.today.toEpochDay()) }
    val calendar = state.calendar
    val month = calendar.shift(state.month, offset)
    val selected = LocalDate.ofEpochDay(selectedDay)
    val overviews = state.overviews(month)
    val lab = Lab.colors

    val slotsByDate = overviews
        .flatMap { o -> o.stats.slots.map { it.date to (o to it.state) } }
        .groupBy({ it.first }, { it.second })
    val daysOff = state.snapshot.daysOff.groupBy { it.date }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = { Text("تقویم") },
                    actions = {
                        if (offset != 0 || selected != state.today) {
                            TextButton(onClick = {
                                offset = 0
                                selectedDay = state.today.toEpochDay()
                            }) { Text("امروز") }
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
                item(key = "grid") {
                    LabCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            MonthSwitcher(
                                title = PersianFormat.monthTitle(month),
                                onPrevious = { offset-- },
                                onNext = { offset++ },
                            )
                            MonthGrid(
                                month = month,
                                calendar = calendar,
                                today = state.today,
                                selected = selected,
                                onSelect = { selectedDay = it.toEpochDay() },
                                marks = { date ->
                                    val slots = slotsByDate[date].orEmpty()
                                    DayMarks(
                                        dots = slots.mapNotNull { (o, s) ->
                                            when (s) {
                                                SlotState.HELD, SlotState.EXTRA -> SchoolPalette.color(o.colorIndex, lab.isDark)
                                                SlotState.MISSED -> lab.missed
                                                SlotState.CANCELED -> lab.canceled
                                                else -> null
                                            }
                                        },
                                        hollowDots = slots.mapNotNull { (o, s) ->
                                            if (s == SlotState.UPCOMING || s == SlotState.TODAY) SchoolPalette.color(o.colorIndex, lab.isDark) else null
                                        },
                                        isDayOff = daysOff.containsKey(date),
                                    )
                                },
                                modifier = Modifier.padding(top = 4.dp),
                            )
                            Spacer(Modifier.padding(4.dp))
                            MonthSummary(overviews)
                        }
                    }
                }

                item(key = "day-header") {
                    SectionHeader(
                        title = PersianFormat.weekdayDayMonth(selected, state.settings.calendar),
                        subtitle = when (selected) {
                            state.today -> "امروز"
                            else -> null
                        },
                    )
                }

                val daySlots = slotsByDate[selected].orEmpty()
                if (daySlots.isEmpty()) {
                    item(key = "day-empty") {
                        Text(
                            if (daysOff.containsKey(selected)) "این روز تعطیل است." else "کلاسی در برنامه‌ی این روز نیست.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(daySlots) { (o, s) ->
                        DaySlotRow(o, s, canLog = !selected.isAfter(state.today), onOpen = { onOpenClass(o.id) }, onLog = { onLog(o.id, selected) })
                    }
                }

                item(key = "days-off") {
                    DayOffCard(state, selected, onToggleDayOff)
                }
            }
        }
    }
}

@Composable
private fun MonthSummary(overviews: List<ClassOverview>) {
    val planned = overviews.sumOf { it.stats.plannedThisMonth }
    val held = overviews.sumOf { it.stats.heldThisMonth }
    val remaining = overviews.sumOf { it.stats.remaining }
    val canceled = overviews.sumOf { it.stats.canceledThisMonth }
    Text(
        "${PersianFormat.digits(planned)} جلسه در این ماه · ${PersianFormat.digits(held)} برگزار شده · " +
            "${PersianFormat.digits(remaining)} مانده" + if (canceled > 0) " · ${PersianFormat.digits(canceled)} کنسل" else "",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 8.dp),
    )
}

@Composable
private fun DaySlotRow(o: ClassOverview, state: SlotState, canLog: Boolean, onOpen: () -> Unit, onLog: () -> Unit) {
    val color = schoolColor(o.colorIndex)
    val lab = Lab.colors
    val (label, labelColor) = when (state) {
        SlotState.HELD -> "برگزار شد" to lab.held
        SlotState.EXTRA -> "جلسه‌ی جبرانی" to lab.held
        SlotState.CANCELED -> "کنسل شد" to lab.canceled
        SlotState.DAY_OFF -> "تعطیل" to lab.dayOff
        SlotState.MISSED -> "ثبت نشده" to lab.missed
        SlotState.TODAY -> "امروز — منتظر ثبت" to MaterialTheme.colorScheme.primary
        SlotState.UPCOMING -> "در برنامه" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    LabCard(Modifier.fillMaxWidth(), accent = color, onClick = onOpen) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniElement(o.schoolClass.symbol, color, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(o.schoolClass.name, style = MaterialTheme.typography.titleSmall)
                Text(label, style = MaterialTheme.typography.bodySmall, color = labelColor)
            }
            if (canLog && (state == SlotState.MISSED || state == SlotState.TODAY)) {
                FilledTonalButton(onClick = onLog) { Text("ثبت") }
            }
        }
    }
}

@Composable
private fun DayOffCard(state: AppState, date: LocalDate, onToggle: (LocalDate, Long?) -> Unit) {
    val offs = state.snapshot.daysOff.filter { it.date == date }
    val schools = state.snapshot.schools
    LabCard(Modifier.fillMaxWidth(), accent = if (offs.isNotEmpty()) Lab.colors.dayOff else null) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            ToggleRow(
                title = "تعطیل برای همه",
                subtitle = "تعطیلی رسمی؛ جلسه‌های این روز در هیچ کلاسی شمرده نمی‌شود",
                checked = offs.any { it.schoolId == null },
                onChange = { onToggle(date, null) },
            )
            if (schools.size > 1) {
                for (school in schools) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ToggleRow(
                        title = "تعطیل فقط در ${school.name}",
                        subtitle = null,
                        checked = offs.any { it.schoolId == school.id },
                        onChange = { onToggle(date, school.id) },
                        leading = { SchoolDot(schoolColor(school.colorIndex)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ToggleRow(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    leading: (@Composable () -> Unit)? = null,
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
