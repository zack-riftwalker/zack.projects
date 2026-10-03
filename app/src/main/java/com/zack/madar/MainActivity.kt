package com.zack.madar

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.zack.madar.ui.MadarViewModel
import com.zack.madar.ui.navigation.MadarRoot
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDateTime

class MainActivity : ComponentActivity() {

    private val vm: MadarViewModel by viewModels { MadarViewModel.Factory }
    private var appliedDark: Boolean? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val versionName = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            MadarRoot(vm, versionName, onDarkTheme = ::applySystemBars)
        }

        // Keep "today" correct across midnight and when coming back to the app.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    vm.refreshToday()
                    val now = LocalDateTime.now()
                    val midnight = now.toLocalDate().plusDays(1).atStartOfDay()
                    delay(Duration.between(now, midnight).toMillis() + 1_000)
                }
            }
        }
    }

    private fun applySystemBars(dark: Boolean) {
        if (appliedDark == dark) return
        appliedDark = dark
        val style = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
}
