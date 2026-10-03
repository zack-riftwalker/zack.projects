package com.zack.madar

import android.app.Application
import android.content.Context
import com.zack.madar.data.db.MadarDatabase
import com.zack.madar.data.prefs.SettingsRepository
import com.zack.madar.data.repo.MadarRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.time.LocalDate

class MadarApp : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}

/** Manual dependency container: one instance of each long-lived object. */
class AppContainer(context: Context) {
    val database = MadarDatabase.create(context)
    val repository = MadarRepository(database)
    val settings = SettingsRepository(context)
    val clock = DayClock()
}

/** The current date as observable state, refreshed when the app resumes and at midnight. */
class DayClock {
    private val current = MutableStateFlow(LocalDate.now())
    val today: StateFlow<LocalDate> = current

    fun refresh() {
        current.value = LocalDate.now()
    }
}
