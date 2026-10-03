package com.zack.madar.ui.school

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.zack.madar.data.db.School
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.WeekdaySet
import com.zack.madar.ui.AppState
import com.zack.madar.ui.components.ElementTile
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.WeekdayPicker
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.SchoolPalette

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditSchoolScreen(
    state: AppState,
    schoolId: Long,
    onBack: () -> Unit,
    onSave: (School) -> Unit,
    onDelete: (School) -> Unit,
) {
    val existing = state.snapshot.school(schoolId)
    val isNew = existing == null
    var name by rememberSaveable { mutableStateOf(existing?.name.orEmpty()) }
    var weekdays by rememberSaveable { mutableIntStateOf(existing?.weekdays ?: 0) }
    var colorIndex by rememberSaveable {
        mutableIntStateOf(existing?.colorIndex ?: (state.snapshot.schools.size % SchoolPalette.groups.size))
    }
    var showErrors by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }

    val nameError = name.isBlank()
    val daysError = WeekdaySet(weekdays).isEmpty
    val color = schoolColor(colorIndex)

    fun save() {
        if (nameError || daysError) {
            showErrors = true
            return
        }
        val base = existing ?: School(name = "", colorIndex = 0, weekdays = 0)
        onSave(base.copy(name = name.trim(), colorIndex = colorIndex, weekdays = weekdays))
    }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) { Icon(Icons.Filled.Close, contentDescription = "بستن") }
                    },
                    title = { Text(if (isNew) "مدرسه‌ی جدید" else "ویرایش مدرسه") },
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
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                LabCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = { Text("نام مدرسه") },
                            placeholder = { Text("مثلاً: دبیرستان فردوسی") },
                            singleLine = true,
                            isError = showErrors && nameError,
                            supportingText = if (showErrors && nameError) {
                                { Text("یک نام برای مدرسه بنویس") }
                            } else {
                                null
                            },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("روزهایی که در این مدرسه هستی", style = MaterialTheme.typography.titleSmall)
                            WeekdayPicker(WeekdaySet(weekdays), { weekdays = it.bits }, color = color)
                            Text(
                                if (showErrors && daysError) {
                                    "حداقل یک روز را انتخاب کن"
                                } else {
                                    "کلاس‌های این مدرسه به‌طور پیش‌فرض همین روزها تشکیل می‌شوند؛ برای هر کلاس می‌شود جدا تغییرش داد."
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = if (showErrors && daysError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                LabCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("خانواده‌ی رنگی", style = MaterialTheme.typography.titleSmall)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                SchoolPalette.groups.indices.forEach { i ->
                                    val swatch = schoolColor(i)
                                    Box(
                                        Modifier
                                            .size(40.dp)
                                            .background(swatch, CircleShape)
                                            .border(
                                                width = if (i == colorIndex) 3.dp else 0.dp,
                                                color = MaterialTheme.colorScheme.onSurface,
                                                shape = CircleShape,
                                            )
                                            .selectable(selected = i == colorIndex, role = Role.RadioButton) { colorIndex = i }
                                            .semantics { contentDescription = SchoolPalette.name(i) },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        if (i == colorIndex) {
                                            Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.surface)
                                        }
                                    }
                                }
                            }
                            Text(
                                "خانواده‌ی ${SchoolPalette.name(colorIndex)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = color,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        ElementTile(
                            symbol = name.trim().take(2).ifBlank { "؟" },
                            name = name.ifBlank { "مدرسه" },
                            number = 1,
                            caption = "${PersianFormat.digits(WeekdaySet(weekdays).size)} روز در هفته",
                            color = color,
                            modifier = Modifier.width(96.dp),
                        )
                    }
                }

                Button(onClick = ::save, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(if (isNew) "ذخیره و افزودن کلاس‌ها" else "ذخیره")
                }

                if (existing != null) {
                    OutlinedButton(
                        onClick = { confirmDelete = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("حذف مدرسه", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }

    if (confirmDelete && existing != null) {
        val classCount = state.snapshot.classes.count { it.schoolId == existing.id }
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("حذف «${existing.name}»؟") },
            text = {
                Text(
                    if (classCount == 0) {
                        "این مدرسه کلاسی ندارد."
                    } else {
                        "${PersianFormat.digits(classCount)} کلاس و همه‌ی جلسه‌های ثبت‌شده‌شان برای همیشه حذف می‌شوند."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    onDelete(existing)
                }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("انصراف") } },
        )
    }
}
