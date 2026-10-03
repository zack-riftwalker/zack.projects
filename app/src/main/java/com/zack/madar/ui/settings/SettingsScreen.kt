package com.zack.madar.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zack.madar.data.prefs.ThemeMode
import com.zack.madar.domain.calendar.CalendarKind
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.ui.AppState
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: AppState,
    versionName: String,
    onBack: () -> Unit,
    onTheme: (ThemeMode) -> Unit,
    onCalendar: (CalendarKind) -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit,
) {
    var confirmImport by rememberSaveable { mutableStateOf(false) }
    val snapshot = state.snapshot

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "بازگشت") }
                    },
                    title = { Text("تنظیمات") },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
        ) { padding ->
            Column(
                Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                SettingCard("ظاهر", "تم «رصدخانه» تیره است و «کاغذ آزمایشگاه» روشن.") {
                    Segmented(
                        options = listOf(ThemeMode.SYSTEM to "مثل گوشی", ThemeMode.LIGHT to "روشن", ThemeMode.DARK to "تیره"),
                        selected = state.settings.theme,
                        onSelect = onTheme,
                    )
                }
                SettingCard("تقویم", "«آخر ماه» و همه‌ی تاریخ‌ها با این تقویم حساب می‌شوند.") {
                    Segmented(
                        options = listOf(CalendarKind.JALALI to "شمسی", CalendarKind.GREGORIAN to "میلادی"),
                        selected = state.settings.calendar,
                        onSelect = onCalendar,
                    )
                }
                SettingCard(
                    "پشتیبان‌گیری",
                    "از همه‌ی مدرسه‌ها، کلاس‌ها و جلسه‌ها یک فایل بساز (مثلاً در گوگل‌درایو یا تلگرام نگه دار) تا با عوض شدن گوشی چیزی از دست نرود.",
                ) {
                    Text(
                        "${PersianFormat.digits(snapshot.schools.size)} مدرسه · ${PersianFormat.digits(snapshot.classes.size)} کلاس · " +
                            "${PersianFormat.digits(snapshot.sessions.size)} جلسه",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    FilledTonalButton(onClick = onExport, modifier = Modifier.fillMaxWidth()) { Text("ساخت فایل پشتیبان") }
                    OutlinedButton(onClick = { confirmImport = true }, modifier = Modifier.fillMaxWidth()) { Text("بازیابی از فایل") }
                }
                SettingCard("درباره", null) {
                    Text("مدار — دفتر کلاس‌های معلم · نسخه‌ی ${PersianFormat.digits(versionName)}", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "فونت وزیرمتن، اثر صابر راستی‌کردار (مجوز OFL)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    if (confirmImport) {
        AlertDialog(
            onDismissRequest = { confirmImport = false },
            title = { Text("بازیابی از فایل پشتیبان؟") },
            text = { Text("همه‌ی اطلاعات فعلی اپ با محتوای فایل جایگزین می‌شود. اگر مطمئن نیستی، اول از وضعیت فعلی پشتیبان بگیر.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmImport = false
                    onImport()
                }) { Text("انتخاب فایل") }
            },
            dismissButton = { TextButton(onClick = { confirmImport = false }) { Text("انصراف") } },
        )
    }
}

@Composable
private fun SettingCard(title: String, hint: String?, content: @Composable () -> Unit) {
    LabCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (value, label) ->
            SegmentedButton(
                selected = value == selected,
                onClick = { onSelect(value) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
            ) { Text(label) }
        }
    }
}
