package com.zack.madar.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zack.madar.domain.calendar.CalendarKind
import com.zack.madar.domain.calendar.MonthCalendar
import com.zack.madar.domain.calendar.MonthSpan
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.WeekdaySet
import com.zack.madar.ui.theme.Lab
import java.time.LocalDate

/** Seven round toggles, Saturday first (ش ی د س چ پ ج). */
@Composable
fun WeekdayPicker(
    selected: WeekdaySet,
    onChange: (WeekdaySet) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    enabled: Boolean = true,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for (day in WeekdaySet.IRANIAN_WEEK) {
            val on = day in selected
            Box(
                Modifier
                    .size(42.dp)
                    .background(if (on) color else Color.Transparent, CircleShape)
                    .border(1.dp, if (on) color else MaterialTheme.colorScheme.outline, CircleShape)
                    .toggleable(value = on, enabled = enabled, role = Role.Checkbox) { onChange(selected.toggle(day)) }
                    .semantics { contentDescription = PersianFormat.weekdayName(day) }
                    .alpha(if (enabled) 1f else 0.6f),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    PersianFormat.weekdayInitial(day),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (on) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** What to draw on one day of a [MonthGrid]. */
data class DayMarks(
    val dots: List<Color> = emptyList(),
    val hollowDots: List<Color> = emptyList(),
    val isDayOff: Boolean = false,
    val enabled: Boolean = true,
)

/** A month as a 7-column grid, Saturday on the right. */
@Composable
fun MonthGrid(
    month: MonthSpan,
    calendar: MonthCalendar,
    today: LocalDate,
    selected: LocalDate?,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    marks: (LocalDate) -> DayMarks = { DayMarks() },
) {
    val lead = Math.floorMod(month.first.dayOfWeek.value - calendar.weekStart.value, 7)
    val cells: List<LocalDate?> = List(lead) { null } + month.dates().toList()
    val weeks = cells.chunked(7)

    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        // Same 4dp gaps as the week rows below, so each label sits over its column.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (day in WeekdaySet.IRANIAN_WEEK) {
                Text(
                    PersianFormat.weekdayInitial(day),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (day == java.time.DayOfWeek.FRIDAY) Lab.colors.dayOff else MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        for (week in weeks) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (i in 0 until 7) {
                    val date = week.getOrNull(i)
                    Box(Modifier.weight(1f)) {
                        if (date != null) {
                            DayCell(
                                date = date,
                                dayNumber = calendar.dayOfMonth(date),
                                isToday = date == today,
                                isSelected = date == selected,
                                marks = marks(date),
                                kind = calendar.kind,
                                onClick = { onSelect(date) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate,
    dayNumber: Int,
    isToday: Boolean,
    isSelected: Boolean,
    marks: DayMarks,
    kind: CalendarKind,
    onClick: () -> Unit,
) {
    val lab = Lab.colors
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(12.dp)
    val background = when {
        isSelected -> scheme.primary
        marks.isDayOff -> lab.dayOffContainer
        else -> Color.Transparent
    }
    val textColor = when {
        isSelected -> scheme.onPrimary
        !marks.enabled -> scheme.onSurfaceVariant.copy(alpha = 0.4f)
        marks.isDayOff || date.dayOfWeek == java.time.DayOfWeek.FRIDAY -> lab.dayOff
        else -> scheme.onSurface
    }
    Surface(
        onClick = onClick,
        enabled = marks.enabled,
        shape = shape,
        color = background,
        border = if (isToday && !isSelected) BorderStroke(1.5.dp, scheme.primary) else null,
        modifier = Modifier
            .aspectRatio(0.9f)
            .semantics {
                this.selected = isSelected
                contentDescription = PersianFormat.weekdayDayMonth(date, kind)
            },
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(
                PersianFormat.digits(dayNumber),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = if (isToday) FontWeight.Black else FontWeight.Medium,
                color = textColor,
            )
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(6.dp)) {
                val dotTint = if (isSelected) scheme.onPrimary else null
                for (c in marks.dots.take(4)) {
                    Box(Modifier.size(5.dp).background(dotTint ?: c, CircleShape))
                }
                for (c in marks.hollowDots.take((4 - marks.dots.size).coerceAtLeast(0))) {
                    Box(Modifier.size(5.dp).border(1.dp, dotTint ?: c, CircleShape))
                }
            }
        }
    }
}

/** Month header with previous/next arrows. In RTL "previous" sits on the right. */
@Composable
fun MonthSwitcher(
    title: String,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrevious) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "ماه قبل")
        }
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        IconButton(onClick = onNext) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "ماه بعد")
        }
        trailing?.invoke()
    }
}

/** Date picker in the user's calendar (Material's picker is Gregorian-only). */
@Composable
fun LabDatePickerDialog(
    initial: LocalDate,
    today: LocalDate,
    calendar: MonthCalendar,
    onDismiss: () -> Unit,
    onConfirm: (LocalDate) -> Unit,
    maxDate: LocalDate? = today,
) {
    var month by remember { mutableStateOf(calendar.monthOf(initial)) }
    var picked by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onConfirm(picked) }) { Text("تأیید") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
        title = {
            Text(PersianFormat.weekdayDayMonth(picked, calendar.kind), style = MaterialTheme.typography.titleLarge)
        },
        text = {
            Column {
                MonthSwitcher(
                    title = PersianFormat.monthTitle(month),
                    onPrevious = { month = calendar.shift(month, -1) },
                    onNext = { month = calendar.shift(month, 1) },
                )
                MonthGrid(
                    month = month,
                    calendar = calendar,
                    today = today,
                    selected = picked,
                    onSelect = { picked = it },
                    marks = { d -> DayMarks(enabled = maxDate == null || !d.isAfter(maxDate)) },
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        },
    )
}
