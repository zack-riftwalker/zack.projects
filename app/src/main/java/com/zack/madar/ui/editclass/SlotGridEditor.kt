package com.zack.madar.ui.editclass

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet
import java.time.DayOfWeek

/** A timetable entry being edited; [row] is which class of the form it belongs to. */
data class FormSlot(val row: Int, val day: DayOfWeek, val period: Int, val repeat: WeekRepeat)

/** Another class's entry, shown faintly so clashes are visible while editing. */
data class OtherSlot(val symbol: String, val color: Color, val day: DayOfWeek, val period: Int, val repeat: WeekRepeat)

val FormSlotsSaver = listSaver<List<FormSlot>, Int>(
    save = { list -> list.flatMap { listOf(it.row, it.day.value, it.period, it.repeat.ordinal) } },
    restore = { flat -> flat.chunked(4).map { FormSlot(it[0], DayOfWeek.of(it[1]), it[2], WeekRepeat.entries[it[3]]) } },
)

private val GRID_DAYS = WeekdaySet.IRANIAN_WEEK.take(6) // شنبه تا پنجشنبه

/** Tap cycle for one cell: empty → every week → odd weeks → even weeks → empty. */
fun cycle(slots: List<FormSlot>, row: Int, day: DayOfWeek, period: Int): List<FormSlot> {
    val existing = slots.firstOrNull { it.row == row && it.day == day && it.period == period }
    val rest = slots - setOfNotNull(existing)
    val next = when (existing?.repeat) {
        null -> WeekRepeat.EVERY
        WeekRepeat.EVERY -> WeekRepeat.ODD
        WeekRepeat.ODD -> WeekRepeat.EVEN
        WeekRepeat.EVEN -> null
    }
    return if (next == null) rest else rest + FormSlot(row, day, period, next)
}

@Composable
fun SlotGridEditor(
    symbols: List<String>,
    activeRow: Int,
    slots: List<FormSlot>,
    others: List<OtherSlot>,
    color: Color,
    schoolDays: WeekdaySet,
    onChange: (List<FormSlot>) -> Unit,
) {
    val usedMax = maxOf(slots.maxOfOrNull { it.period } ?: 0, others.maxOfOrNull { it.period } ?: 0)
    var periods by rememberSaveable { mutableIntStateOf(maxOf(4, usedMax)) }
    if (periods < usedMax) periods = usedMax
    val line = MaterialTheme.colorScheme.outlineVariant

    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()) {
            Spacer(Modifier.width(30.dp))
            for (day in GRID_DAYS) {
                val atSchool = day in schoolDays
                Text(
                    PersianFormat.weekdayInitial(day),
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 2.dp)
                        .background(if (atSchool) color.copy(alpha = 0.14f) else Color.Transparent, RoundedCornerShape(6.dp))
                        .padding(vertical = 4.dp),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (atSchool) FontWeight.Bold else FontWeight.Normal,
                    textAlign = TextAlign.Center,
                )
            }
        }
        for (period in 1..periods) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(line))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    PersianFormat.digits(period),
                    modifier = Modifier.width(30.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                for (day in GRID_DAYS) {
                    val mine = slots.firstOrNull { it.row == activeRow && it.day == day && it.period == period }
                    val batch = slots.filter { it.row != activeRow && it.day == day && it.period == period }
                    val other = others.filter { it.day == day && it.period == period }
                    val label = "${PersianFormat.weekdayName(day)} زنگ ${PersianFormat.digits(period)}"
                    Box(
                        Modifier
                            .weight(1f)
                            .height(46.dp)
                            .padding(2.dp)
                            .background(
                                if (mine != null) color.copy(alpha = if (mine.repeat == WeekRepeat.EVERY) 0.85f else 0.45f) else Color.Transparent,
                                RoundedCornerShape(8.dp),
                            )
                            .border(
                                1.dp,
                                if (mine != null) color else MaterialTheme.colorScheme.outlineVariant,
                                RoundedCornerShape(8.dp),
                            )
                            .clickable(role = Role.Button) { onChange(cycle(slots, activeRow, day, period)) }
                            .semantics { contentDescription = label + (mine?.let { "، " + repeatLabel(it.repeat) } ?: "") },
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            if (mine != null) {
                                Text(
                                    symbols.getOrNull(activeRow).orEmpty().ifBlank { "✓" },
                                    style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp),
                                    fontWeight = FontWeight.Black,
                                    color = if (mine.repeat == WeekRepeat.EVERY) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                )
                                if (mine.repeat != WeekRepeat.EVERY) {
                                    Text(
                                        if (mine.repeat == WeekRepeat.ODD) "فرد" else "زوج",
                                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                }
                            }
                            val faint = batch.map { symbols.getOrNull(it.row).orEmpty() } + other.map { it.symbol }
                            if (faint.isNotEmpty()) {
                                Text(
                                    faint.joinToString(" "),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                    color = if (mine != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
        TextButton(onClick = { periods++ }) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text("زنگ بیشتر")
        }
        Text(
            "روی هر خانه بزن: یک بار = هر هفته · دوباره = فقط هفته‌ی فرد · دوباره = فقط زوج · دوباره = حذف. " +
                "اسم‌های کم‌رنگ، کلاس‌های دیگرت در همان زنگ‌اند.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

fun repeatLabel(repeat: WeekRepeat): String = when (repeat) {
    WeekRepeat.EVERY -> "هر هفته"
    WeekRepeat.ODD -> "فقط هفته‌ی فرد"
    WeekRepeat.EVEN -> "فقط هفته‌ی زوج"
}
