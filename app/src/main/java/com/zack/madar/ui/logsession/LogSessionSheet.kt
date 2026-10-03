package com.zack.madar.ui.logsession

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zack.madar.data.db.Session
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.ScheduleCalculator
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.ui.AppState
import com.zack.madar.ui.LogDraft
import com.zack.madar.ui.components.LabDatePickerDialog
import com.zack.madar.ui.components.MiniElement
import com.zack.madar.ui.schoolColor
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogSessionSheet(
    initial: LogDraft,
    state: AppState,
    onDismiss: () -> Unit,
    onSubmit: (LogDraft) -> Unit,
    onDelete: (Session) -> Unit,
) {
    if (state.overview(initial.classId) == null) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        LogSessionForm(initial, state, onSubmit, onDelete, Modifier.navigationBarsPadding().imePadding())
    }
}

/** The form itself, separate from the sheet so it can be previewed and screenshot-tested. */
@Composable
fun LogSessionForm(
    initial: LogDraft,
    state: AppState,
    onSubmit: (LogDraft) -> Unit,
    onDelete: (Session) -> Unit,
    modifier: Modifier = Modifier,
) {
    val overview = state.overview(initial.classId) ?: return
    val cls = overview.schoolClass
    val color = schoolColor(overview.colorIndex)
    val kind = state.settings.calendar
    val haptics = LocalHapticFeedback.current

    var draft by remember(initial) { mutableStateOf(initial) }
    var pickingDate by remember { mutableStateOf(false) }
    var showNotes by remember(initial) { mutableStateOf(initial.notes.isNotBlank()) }
    val suggestions = remember(state.snapshot, cls.id) { state.topicSuggestions(cls.id) }
    val held = draft.status == SessionStatus.HELD

    val sessions = state.snapshot.sessionsOf(cls.id)
    val number = if (draft.isEditing) {
        ScheduleCalculator.sessionNumbers(sessions.map { it.toRecord() }, cls.priorSessions)[draft.sessionId]
    } else {
        cls.priorSessions + 1 + sessions.count { it.status == SessionStatus.HELD && !it.date.isAfter(draft.date) }
    }

    // Quick dates: today plus this class's recent regular days, newest first.
    val quickDates = remember(state.today, cls.id, draft.date) {
        val plan = cls.plan(overview.school)
        val recent = (0L..14L).map { state.today.minusDays(it) }
            .filter { it == state.today || ScheduleCalculator.isScheduled(plan, it) }
            .take(4)
        (recent + draft.date).distinct().sortedDescending()
    }

    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MiniElement(cls.symbol, color, size = 48.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(
                    when {
                        draft.isEditing -> "ویرایش جلسه"
                        held -> "ثبت جلسه‌ی ${PersianFormat.digits(number ?: 0)}"
                        else -> "ثبت کنسلی"
                    },
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    "${cls.name} · ${overview.school?.name.orEmpty()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val options = listOf(SessionStatus.HELD to "برگزار شد", SessionStatus.CANCELED to "کنسل شد")
            options.forEachIndexed { i, (status, label) ->
                SegmentedButton(
                    selected = draft.status == status,
                    onClick = { draft = draft.copy(status = status) },
                    shape = SegmentedButtonDefaults.itemShape(i, options.size),
                ) { Text(label) }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("تاریخ", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(quickDates, key = { it.toEpochDay() }) { date ->
                    FilterChip(
                        selected = draft.date == date,
                        onClick = { draft = draft.copy(date = date) },
                        label = { Text(PersianFormat.relativeDay(date, state.today, kind)) },
                    )
                }
                item {
                    FilterChip(
                        selected = false,
                        onClick = { pickingDate = true },
                        label = { Text("تاریخ دیگر") },
                        leadingIcon = { Icon(Icons.Filled.DateRange, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    )
                }
            }
        }

        if (held) {
            if (suggestions.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(suggestions, key = { it.label + it.topic }) { s ->
                        SuggestionChip(
                            onClick = {
                                draft = draft.copy(
                                    topic = s.topic,
                                    chapter = draft.chapter.ifBlank { s.chapter },
                                    page = draft.page.ifBlank { s.page },
                                )
                            },
                            label = {
                                Text(
                                    "${s.label}: ${s.topic}",
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.width(220.dp),
                                )
                            },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = draft.topic,
                onValueChange = { draft = draft.copy(topic = it) },
                label = { Text("تا کجا درس دادی؟") },
                placeholder = { Text("مثلاً: ساختار اتم — تا آخر فعالیت ۲") },
                minLines = 2,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = draft.chapter,
                    onValueChange = { draft = draft.copy(chapter = PersianFormat.toAsciiDigits(it).take(12)) },
                    label = { Text("فصل") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = draft.page,
                    onValueChange = { draft = draft.copy(page = PersianFormat.toAsciiDigits(it).take(12)) },
                    label = { Text("تا صفحه") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (showNotes || !held) {
            OutlinedTextField(
                value = draft.notes,
                onValueChange = { draft = draft.copy(notes = it) },
                label = { Text(if (held) "یادداشت / تکلیف" else "علت (اختیاری)") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            TextButton(onClick = { showNotes = true }) { Text("+ یادداشت یا تکلیف") }
        }

        Button(
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                onSubmit(draft)
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text(if (draft.isEditing) "ذخیره‌ی تغییرات" else "ثبت", style = MaterialTheme.typography.titleMedium)
        }
        if (draft.isEditing) {
            TextButton(
                onClick = { sessions.firstOrNull { it.id == draft.sessionId }?.let(onDelete) },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) { Text("حذف این جلسه", color = MaterialTheme.colorScheme.error) }
        }
    }

    if (pickingDate) {
        LabDatePickerDialog(
            initial = draft.date,
            today = state.today,
            calendar = state.calendar,
            onDismiss = { pickingDate = false },
            onConfirm = { date: LocalDate ->
                draft = draft.copy(date = date)
                pickingDate = false
            },
        )
    }
}
