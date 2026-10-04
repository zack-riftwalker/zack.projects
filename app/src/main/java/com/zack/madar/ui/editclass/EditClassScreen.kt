package com.zack.madar.ui.editclass

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.zack.madar.data.db.ClassSlot
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.repo.NewClass
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.ClassPlan
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet
import com.zack.madar.domain.schedule.WeeklySlot
import com.zack.madar.ui.AppState
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.LabDatePickerDialog
import com.zack.madar.ui.components.SchoolDot
import com.zack.madar.ui.schoolColor
import java.time.LocalDate

private data class NameRow(val name: String, val symbol: String, val symbolTouched: Boolean)

private val RowsSaver = listSaver<List<NameRow>, String>(
    save = { rows -> rows.flatMap { listOf(it.name, it.symbol, it.symbolTouched.toString()) } },
    restore = { flat -> flat.chunked(3).map { NameRow(it[0], it[1], it[2].toBoolean()) } },
)

private val GRADES = listOf("هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم")

/** «کلاس ۷۰۱» → «۷۰۱»; «هفتم الف» → «هال». */
internal fun autoSymbol(name: String): String {
    val digits = Regex("[0-9۰-۹]+").find(name)?.value
    if (digits != null) return PersianFormat.digits(PersianFormat.toAsciiDigits(digits)).take(4)
    return name.split(' ', '‌').filter { it.isNotBlank() }.joinToString("") { it.take(1) }.take(3)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditClassScreen(
    state: AppState,
    classId: Long,
    initialSchoolId: Long,
    onBack: () -> Unit,
    onAdd: (template: SchoolClass, classes: List<NewClass>) -> Unit,
    onUpdate: (SchoolClass, List<ClassSlot>) -> Unit,
) {
    // Form fields are seeded once from the stored class, so wait for the data (e.g. after process restore).
    if (!state.loaded) return
    val existing = state.snapshot.classes.firstOrNull { it.id == classId }
    val isNew = classId == 0L
    val schools = state.snapshot.schools
    var submitted by remember { mutableStateOf(false) }

    var schoolId by rememberSaveable {
        mutableLongStateOf(existing?.schoolId ?: initialSchoolId.takeIf { id -> schools.any { it.id == id } } ?: schools.firstOrNull()?.id ?: 0L)
    }
    var rows by rememberSaveable(stateSaver = RowsSaver) {
        mutableStateOf(listOf(NameRow(existing?.name.orEmpty(), existing?.symbol.orEmpty(), existing != null)))
    }
    var grade by rememberSaveable { mutableStateOf(existing?.grade.orEmpty()) }
    var subject by rememberSaveable { mutableStateOf(existing?.subject ?: lastSubject(state)) }
    var slots by rememberSaveable(stateSaver = FormSlotsSaver) {
        mutableStateOf(state.snapshot.slotsOf(classId).map { FormSlot(0, it.day, it.period, it.repeat) })
    }
    var activeRow by rememberSaveable { mutableIntStateOf(0) }
    var prior by rememberSaveable { mutableIntStateOf(existing?.priorSessions ?: 0) }
    var startDay by rememberSaveable { mutableLongStateOf(existing?.trackingStartEpochDay ?: state.today.toEpochDay()) }
    var showErrors by rememberSaveable { mutableStateOf(false) }
    var pickingStart by rememberSaveable { mutableStateOf(false) }

    val school = state.snapshot.school(schoolId)
    val color = schoolColor(school?.colorIndex ?: 0)
    val validRows = rows.withIndex().filter { it.value.name.isNotBlank() }
    val namesError = validRows.isEmpty()
    val rowsWithoutSlots = validRows.filter { (i, _) -> slots.none { it.row == i } }
    val daysError = rowsWithoutSlots.isNotEmpty()
    val symbols = rows.map { it.symbol.ifBlank { autoSymbol(it.name) } }
    val others = state.snapshot.slots
        .filter { it.classId != classId }
        .mapNotNull { slot ->
            val c = state.snapshot.activeClasses.firstOrNull { it.id == slot.classId } ?: return@mapNotNull null
            OtherSlot(c.symbol, schoolColor(state.snapshot.school(c.schoolId)?.colorIndex ?: 0), slot.day, slot.period, slot.repeat)
        }

    fun save() {
        // Editing a class that no longer exists must not silently re-create it; a second tap must not add twice.
        if (submitted || (!isNew && existing == null)) return
        if (namesError || daysError || school == null) {
            showErrors = true
            return
        }
        submitted = true
        val template = (existing ?: SchoolClass(schoolId = schoolId, name = "", symbol = "", trackingStartEpochDay = startDay)).copy(
            schoolId = schoolId,
            grade = grade.trim(),
            subject = subject.trim(),
            weekdaysOverride = null,
            priorSessions = prior,
            trackingStartEpochDay = startDay,
        )
        val named = validRows.map { (i, row) ->
            NewClass(
                name = row.name.trim(),
                symbol = row.symbol.trim().ifBlank { autoSymbol(row.name.trim()) },
                slots = slots.filter { it.row == i }.map { ClassSlot(classId = 0, dayOfWeek = it.day.value, period = it.period, repeat = it.repeat) },
            )
        }
        if (existing != null) {
            onUpdate(template.copy(name = named[0].name, symbol = named[0].symbol), named[0].slots)
        } else {
            onAdd(template, named)
        }
    }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Filled.Close, contentDescription = "بستن") } },
                    title = { Text(if (isNew) "کلاس جدید" else "ویرایش کلاس") },
                    actions = { TextButton(onClick = ::save) { Text("ذخیره") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
        ) { padding ->
            Column(
                Modifier
                    .padding(padding)
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                FormCard("مدرسه") {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(schools, key = { it.id }) { s ->
                            FilterChip(
                                selected = s.id == schoolId,
                                onClick = { schoolId = s.id },
                                label = { Text(s.name) },
                                leadingIcon = { SchoolDot(schoolColor(s.colorIndex)) },
                            )
                        }
                    }
                }

                FormCard(
                    if (isNew) "کلاس‌ها" else "نام کلاس",
                    hint = if (isNew) "چند کلاس هم‌برنامه را یک‌جا اضافه کن. «نماد» روی کاشی نوشته می‌شود." else null,
                ) {
                    rows.forEachIndexed { index, row ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = row.name,
                                onValueChange = { v ->
                                    rows = rows.toMutableList().also {
                                        it[index] = row.copy(name = v, symbol = if (row.symbolTouched) row.symbol else autoSymbol(v))
                                    }
                                },
                                label = { Text("نام") },
                                placeholder = { Text("مثلاً: هفتم ۱") },
                                singleLine = true,
                                isError = showErrors && namesError,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = row.symbol,
                                onValueChange = { v ->
                                    rows = rows.toMutableList().also { it[index] = row.copy(symbol = v.take(4), symbolTouched = true) }
                                },
                                label = { Text("نماد") },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.titleMedium.copy(textAlign = TextAlign.Center),
                                modifier = Modifier.width(84.dp),
                            )
                            if (rows.size > 1) {
                                IconButton(onClick = {
                                    rows = rows.filterIndexed { i, _ -> i != index }
                                    // Drop the removed class's timetable and shift the ones after it up.
                                    slots = slots.filter { it.row != index }.map { if (it.row > index) it.copy(row = it.row - 1) else it }
                                    activeRow = activeRow.coerceAtMost(rows.lastIndex)
                                }) {
                                    Icon(Icons.Filled.Close, contentDescription = "حذف ردیف")
                                }
                            }
                        }
                    }
                    if (showErrors && namesError) {
                        Text("حداقل یک نام کلاس بنویس", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    if (isNew) {
                        TextButton(onClick = { rows = rows + NameRow("", "", false) }) {
                            Icon(Icons.Filled.Add, contentDescription = null)
                            Spacer(Modifier.width(4.dp))
                            Text("یک کلاس دیگر")
                        }
                    }
                }

                FormCard("پایه و درس", hint = "کلاس‌های هم‌پایه موقع ثبت، مبحثِ هم را پیشنهاد می‌دهند.") {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(GRADES) { g ->
                            FilterChip(selected = grade == g, onClick = { grade = if (grade == g) "" else g }, label = { Text(g) })
                        }
                    }
                    OutlinedTextField(
                        value = subject,
                        onValueChange = { subject = it },
                        label = { Text("درس (اختیاری)") },
                        placeholder = { Text("مثلاً: علوم تجربی") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                FormCard(
                    "برنامه‌ی هفتگی",
                    hint = "زنگ‌های این کلاس را روی جدول بزن. اگر کلاس یک هفته دو جلسه و هفته‌ی بعد یک جلسه است، زنگِ اضافه را «فقط فرد» یا «فقط زوج» کن.",
                ) {
                    if (validRows.size > 1) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(validRows.map { it.index }) { i ->
                                FilterChip(
                                    selected = activeRow == i,
                                    onClick = { activeRow = i },
                                    label = { Text(rows[i].name) },
                                    leadingIcon = { SchoolDot(color) },
                                )
                            }
                        }
                    }
                    SlotGridEditor(
                        symbols = symbols,
                        activeRow = activeRow,
                        slots = slots,
                        others = others,
                        color = color,
                        schoolDays = school?.weekdaySet ?: WeekdaySet.NONE,
                        onChange = { slots = it },
                    )
                    if (showErrors && daysError) {
                        Text(
                            "برای ${rowsWithoutSlots.joinToString("، ") { "«${it.value.name}»" }} حداقل یک زنگ روی جدول بزن",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    SchedulePreview(state, slots.filter { it.row == activeRow }, school?.flipParity ?: false)
                }

                FormCard("نقطه‌ی شروع") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("تا امروز چند جلسه برگزار شده؟", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "اگر سال تازه شروع شده، صفر بماند.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        FilledTonalIconButton(onClick = { if (prior > 0) prior-- }) { Text("−", style = MaterialTheme.typography.titleLarge) }
                        Text(
                            PersianFormat.digits(prior),
                            style = MaterialTheme.typography.titleLarge,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.width(44.dp),
                        )
                        FilledTonalIconButton(onClick = { prior++ }) { Text("+", style = MaterialTheme.typography.titleLarge) }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("ثبت در مدار از", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "روزهای قبل از این تاریخ «ثبت‌نشده» حساب نمی‌شوند.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        OutlinedButton(onClick = { pickingStart = true }) {
                            Icon(Icons.Filled.DateRange, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text(PersianFormat.dayMonth(LocalDate.ofEpochDay(startDay), state.settings.calendar))
                        }
                    }
                }

                Button(onClick = ::save, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(
                        when {
                            !isNew -> "ذخیره"
                            validRows.size > 1 -> "افزودن ${PersianFormat.digits(validRows.size)} کلاس"
                            else -> "افزودن کلاس"
                        },
                    )
                }
            }
        }
    }

    if (pickingStart) {
        LabDatePickerDialog(
            initial = LocalDate.ofEpochDay(startDay),
            today = state.today,
            calendar = state.calendar,
            maxDate = null,
            onDismiss = { pickingStart = false },
            onConfirm = {
                startDay = it.toEpochDay()
                pickingStart = false
            },
        )
    }
}

private fun lastSubject(state: AppState): String = state.snapshot.classes.lastOrNull()?.subject.orEmpty()

/** Live answer to "so how many sessions is that?" while the timetable is edited. */
@Composable
private fun SchedulePreview(state: AppState, slots: List<FormSlot>, flip: Boolean) {
    if (slots.isEmpty()) return
    val weekly = slots.map { WeeklySlot(it.day, it.period, it.repeat) }
    val odd = weekly.count { it.repeat != WeekRepeat.EVEN }
    val even = weekly.count { it.repeat != WeekRepeat.ODD }
    val month = state.month
    // The whole month is counted regardless of the tracking start, so the plan starts at the month's first day.
    val stats = ScheduleCalculator.monthStats(
        ClassPlan(weekly, month.first, 0, flip),
        emptyList(),
        emptySet(),
        month,
        state.today,
    )
    val perWeek = if (odd == even) {
        "${PersianFormat.digits(odd)} جلسه در هفته"
    } else {
        "هفته‌ی فرد ${PersianFormat.digits(odd)} جلسه، هفته‌ی زوج ${PersianFormat.digits(even)} جلسه"
    }
    Text(
        "$perWeek · در ${PersianFormat.monthName(month)}: ${PersianFormat.digits(stats.slots.size)} جلسه، " +
            "${PersianFormat.digits(stats.remaining)} تا آخر ماه",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun FormCard(title: String, hint: String? = null, content: @Composable () -> Unit) {
    LabCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}
