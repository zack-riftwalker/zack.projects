package com.zack.madar.ui

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.zack.madar.MadarApp
import com.zack.madar.data.backup.BackupCodec
import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.prefs.SettingsRepository
import com.zack.madar.data.prefs.ThemeMode
import com.zack.madar.data.repo.MadarRepository
import com.zack.madar.domain.calendar.CalendarKind
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.DayClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

/** What the log sheet is editing: a new session or an existing one. */
data class LogDraft(
    val classId: Long,
    val date: LocalDate,
    val status: SessionStatus = SessionStatus.HELD,
    val sessionId: Long = 0,
    val topic: String = "",
    val chapter: String = "",
    val page: String = "",
    val notes: String = "",
    val createdAt: Long = 0,
) {
    val isEditing: Boolean get() = sessionId != 0L
}

/** A transient message for the snackbar, optionally undoable. */
class UiMessage(val text: String, val actionLabel: String? = null, val action: (suspend () -> Unit)? = null)

class MadarViewModel(
    private val repo: MadarRepository,
    private val settingsRepo: SettingsRepository,
    private val clock: DayClock,
) : ViewModel() {

    val state: StateFlow<AppState> =
        combine(repo.snapshot, settingsRepo.settings, clock.today) { snapshot, settings, today ->
            AppState(snapshot, settings, today, loaded = true)
        }.stateIn(viewModelScope, SharingStarted.Eagerly, AppState())

    private val draft = MutableStateFlow<LogDraft?>(null)
    val logDraft: StateFlow<LogDraft?> = draft

    private val messageChannel = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = messageChannel.receiveAsFlow()

    private fun say(text: String, undo: (suspend () -> Unit)? = null) {
        messageChannel.trySend(UiMessage(text, if (undo != null) "بازگردانی" else null, undo))
    }

    fun runUndo(message: UiMessage) {
        val action = message.action ?: return
        viewModelScope.launch { action() }
    }

    fun refreshToday() = clock.refresh()

    // Log sheet

    fun openLog(classId: Long, date: LocalDate = state.value.today, status: SessionStatus = SessionStatus.HELD) {
        draft.value = LogDraft(classId = classId, date = date, status = status)
    }

    fun editSession(session: Session) {
        draft.value = LogDraft(
            classId = session.classId,
            date = session.date,
            status = session.status,
            sessionId = session.id,
            topic = session.topic,
            chapter = session.chapter,
            page = session.page,
            notes = session.notes,
            createdAt = session.createdAt,
        )
    }

    fun dismissLog() {
        draft.value = null
    }

    fun submitLog(d: LogDraft) {
        draft.value = null
        viewModelScope.launch {
            val snapshot = state.value.snapshot
            val cls = snapshot.classes.firstOrNull { it.id == d.classId } ?: return@launch
            val session = Session(
                id = d.sessionId,
                classId = d.classId,
                epochDay = d.date.toEpochDay(),
                status = d.status,
                topic = d.topic.trim(),
                chapter = d.chapter.trim(),
                page = d.page.trim(),
                notes = d.notes.trim(),
                createdAt = d.createdAt,
            )
            repo.saveSession(session)
            when {
                d.isEditing -> say("تغییرات جلسه ذخیره شد")
                d.status == SessionStatus.CANCELED -> say("جلسه‌ی ${cls.name} کنسل ثبت شد")
                else -> {
                    val number = cls.priorSessions + 1 + snapshot.sessionsOf(cls.id)
                        .count { it.status == SessionStatus.HELD && !it.date.isAfter(d.date) }
                    say("جلسه‌ی ${PersianFormat.digits(number)} ${cls.name} ثبت شد")
                }
            }
        }
    }

    fun deleteSession(session: Session) {
        draft.value = null
        viewModelScope.launch {
            repo.deleteSession(session)
            say("جلسه حذف شد") { repo.restoreSession(session) }
        }
    }

    /** One-tap "this session didn't happen" for a scheduled day. */
    fun markCanceled(classId: Long, date: LocalDate) {
        viewModelScope.launch {
            val id = repo.saveSession(Session(classId = classId, epochDay = date.toEpochDay(), status = SessionStatus.CANCELED))
            say("کنسل ثبت شد") { repo.deleteSession(Session(id = id, classId = classId, epochDay = date.toEpochDay())) }
        }
    }

    // Schools & classes

    fun saveSchool(school: School, onSaved: (Long) -> Unit = {}) {
        viewModelScope.launch {
            val id = repo.saveSchool(school)
            say(if (school.id == 0L) "مدرسه‌ی «${school.name}» اضافه شد" else "مدرسه ذخیره شد")
            onSaved(id)
        }
    }

    fun deleteSchool(school: School) {
        viewModelScope.launch {
            repo.deleteSchool(school)
            say("مدرسه‌ی «${school.name}» حذف شد")
        }
    }

    fun addClasses(template: SchoolClass, names: List<Pair<String, String>>) {
        viewModelScope.launch {
            repo.addClasses(template, names)
            say(
                if (names.size == 1) "کلاس «${names[0].first}» اضافه شد"
                else "${PersianFormat.digits(names.size)} کلاس اضافه شد",
            )
        }
    }

    fun updateClass(schoolClass: SchoolClass) {
        viewModelScope.launch {
            repo.updateClass(schoolClass)
            say("کلاس ذخیره شد")
        }
    }

    fun deleteClass(schoolClass: SchoolClass) {
        viewModelScope.launch {
            val deleted = repo.deleteClass(schoolClass)
            say("کلاس «${schoolClass.name}» حذف شد") { repo.restoreClass(deleted) }
        }
    }

    // Days off

    fun toggleDayOff(date: LocalDate, schoolId: Long?) {
        viewModelScope.launch {
            val existing = state.value.snapshot.daysOff
                .firstOrNull { it.epochDay == date.toEpochDay() && it.schoolId == schoolId }
            if (existing != null) {
                repo.deleteDayOff(existing)
                say("تعطیلی برداشته شد")
            } else {
                repo.addDayOff(DayOff(epochDay = date.toEpochDay(), schoolId = schoolId))
                say("تعطیل ثبت شد؛ جلسه‌های این روز شمرده نمی‌شوند")
            }
        }
    }

    // Settings

    fun setTheme(mode: ThemeMode) {
        viewModelScope.launch { settingsRepo.setTheme(mode) }
    }

    fun setCalendar(kind: CalendarKind) {
        viewModelScope.launch { settingsRepo.setCalendar(kind) }
    }

    fun exportBackup(resolver: ContentResolver, uri: Uri) {
        viewModelScope.launch {
            val ok = runCatching {
                val json = BackupCodec.encode(state.value.snapshot)
                withContext(Dispatchers.IO) {
                    resolver.openOutputStream(uri, "wt")!!.bufferedWriter().use { it.write(json) }
                }
            }.isSuccess
            say(if (ok) "پشتیبان ذخیره شد" else "ذخیره‌ی پشتیبان ناموفق بود")
        }
    }

    fun importBackup(resolver: ContentResolver, uri: Uri) {
        viewModelScope.launch {
            val result = runCatching {
                val text = withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
                }
                repo.replaceAll(BackupCodec.decode(text))
            }
            say(if (result.isSuccess) "اطلاعات از فایل پشتیبان بازیابی شد" else "این فایل پشتیبانِ مدار نیست")
        }
    }

    companion object {
        val Factory = viewModelFactory {
            initializer {
                val container = (this[APPLICATION_KEY] as MadarApp).container
                MadarViewModel(container.repository, container.settings, container.clock)
            }
        }
    }
}
