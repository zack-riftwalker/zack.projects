package com.zack.madar.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.zack.madar.ui.calendar.CalendarScreen
import com.zack.madar.ui.classdetail.ClassDetailScreen
import com.zack.madar.ui.classes.ClassesScreen
import com.zack.madar.ui.editclass.EditClassScreen
import com.zack.madar.ui.logsession.LogSessionForm
import com.zack.madar.ui.school.EditSchoolScreen
import com.zack.madar.ui.settings.SettingsScreen
import com.zack.madar.ui.theme.MadarTheme
import com.zack.madar.ui.timetable.TimetableScreen
import com.zack.madar.ui.today.TodayScreen
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders every screen with [SampleData] in both themes.
 * `./gradlew recordRoborazziDebug` writes the images to app/build/outputs/roborazzi.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w400dp-h880dp-xxhdpi")
class ScreenshotTest {

    private fun shot(name: String, dark: Boolean, content: @Composable (AppState) -> Unit) {
        val state = if (name.startsWith("onboarding")) SampleData.empty(dark) else SampleData.state(dark)
        captureRoboImage("build/outputs/roborazzi/${name}_${if (dark) "dark" else "light"}.png") {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                MadarTheme(dark) { content(state) }
            }
        }
    }

    private fun both(name: String, content: @Composable (AppState) -> Unit) {
        shot(name, dark = true, content)
        shot(name, dark = false, content)
    }

    @Test
    fun today() = both("01_today") { s ->
        TodayScreen(s, {}, { _, _ -> }, {}, { _, _ -> }, {}, {}, {})
    }

    @Test
    fun onboarding() = both("onboarding") { s ->
        TodayScreen(s, {}, { _, _ -> }, {}, { _, _ -> }, {}, {}, {})
    }

    @Test
    fun classes() = both("02_classes") { s ->
        ClassesScreen(s, {}, {}, {}, {})
    }

    @Test
    fun classDetail() = both("03_class_detail") { s ->
        ClassDetailScreen(s, classId = 1, onBack = {}, onEdit = {}, onDelete = {}, onLog = {}, onEditSession = {}, onMarkCanceled = {})
    }

    @Test
    fun classDetailMissed() = both("04_class_detail_missed") { s ->
        ClassDetailScreen(s, classId = 3, onBack = {}, onEdit = {}, onDelete = {}, onLog = {}, onEditSession = {}, onMarkCanceled = {})
    }

    @Test
    fun logSheet() = both("05_log_session") { s ->
        Box(Modifier.fillMaxSize()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = MaterialTheme.shapes.extraLarge,
                modifier = Modifier.padding(top = 120.dp),
            ) {
                LogSessionForm(LogDraft(classId = 2, date = s.today), s, {}, {}, Modifier.padding(top = 24.dp))
            }
        }
    }

    @Test
    fun timetable() = both("10_timetable") { s ->
        TimetableScreen(s, {}, {})
    }

    @Test
    fun editClassTimetable() = both("11_edit_class_timetable") { s ->
        EditClassScreen(s, classId = 3, initialSchoolId = 1, onBack = {}, onAdd = { _, _ -> }, onUpdate = { _, _ -> })
    }

    @Test
    fun calendar() = both("06_calendar") { s ->
        CalendarScreen(s, {}, { _, _ -> }, { _, _ -> })
    }

    @Test
    fun editClass() = both("07_add_classes") { s ->
        EditClassScreen(s, classId = 0, initialSchoolId = 2, onBack = {}, onAdd = { _, _ -> }, onUpdate = { _, _ -> })
    }

    @Test
    fun editSchool() = both("08_edit_school") { s ->
        EditSchoolScreen(s, schoolId = 1, onBack = {}, onSave = {}, onDelete = {})
    }

    @Test
    fun settings() = both("09_settings") { s ->
        SettingsScreen(s, "1.0.0", {}, {}, {}, {}, {})
    }
}
