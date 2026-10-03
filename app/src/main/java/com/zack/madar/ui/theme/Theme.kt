package com.zack.madar.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.zack.madar.data.prefs.ThemeMode

private val MadarShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun isDarkTheme(mode: ThemeMode): Boolean = when (mode) {
    ThemeMode.SYSTEM -> isSystemInDarkTheme()
    ThemeMode.LIGHT -> false
    ThemeMode.DARK -> true
}

/** App theme. The whole UI is Persian, so layout is right-to-left regardless of the device locale. */
@Composable
fun MadarTheme(dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalLabColors provides if (dark) ObservatoryLab else LabPaperLab,
        LocalLayoutDirection provides LayoutDirection.Rtl,
    ) {
        MaterialTheme(
            colorScheme = if (dark) ObservatoryColors else LabPaperColors,
            typography = MadarTypography,
            shapes = MadarShapes,
            content = content,
        )
    }
}

object Lab {
    val colors: LabColors
        @Composable get() = LocalLabColors.current
}
