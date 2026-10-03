package com.zack.madar.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// «رصدخانه» — deep-space dark theme.
internal val ObservatoryColors = darkColorScheme(
    primary = Color(0xFF22D3EE),
    onPrimary = Color(0xFF00313A),
    primaryContainer = Color(0xFF0B4554),
    onPrimaryContainer = Color(0xFFA5F3FC),
    secondary = Color(0xFFA78BFA),
    onSecondary = Color(0xFF2E1065),
    secondaryContainer = Color(0xFF35265F),
    onSecondaryContainer = Color(0xFFDDD6FE),
    tertiary = Color(0xFF34D399),
    onTertiary = Color(0xFF003824),
    tertiaryContainer = Color(0xFF0B4A37),
    onTertiaryContainer = Color(0xFFA7F3D0),
    error = Color(0xFFF87171),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF5B1A1A),
    onErrorContainer = Color(0xFFFECACA),
    background = Color(0xFF0B1120),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF0B1120),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1A2540),
    onSurfaceVariant = Color(0xFF94A3B8),
    surfaceContainerLowest = Color(0xFF080D19),
    surfaceContainerLow = Color(0xFF0F182B),
    surfaceContainer = Color(0xFF131D33),
    surfaceContainerHigh = Color(0xFF18243E),
    surfaceContainerHighest = Color(0xFF1F2C4A),
    surfaceBright = Color(0xFF26355A),
    surfaceDim = Color(0xFF0B1120),
    outline = Color(0xFF3B4A66),
    outlineVariant = Color(0xFF243150),
    inverseSurface = Color(0xFFE2E8F0),
    inverseOnSurface = Color(0xFF0F172A),
    inversePrimary = Color(0xFF0E7490),
    scrim = Color(0xFF000000),
)

// «کاغذ آزمایشگاه» — graph-paper light theme.
internal val LabPaperColors = lightColorScheme(
    primary = Color(0xFF0E7490),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFCFF4FC),
    onPrimaryContainer = Color(0xFF083344),
    secondary = Color(0xFF6D28D9),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEDE9FE),
    onSecondaryContainer = Color(0xFF2E1065),
    tertiary = Color(0xFF047857),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD1FAE5),
    onTertiaryContainer = Color(0xFF022C22),
    error = Color(0xFFC62828),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
    background = Color(0xFFF4F7FB),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFF4F7FB),
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFE2E8F0),
    onSurfaceVariant = Color(0xFF475569),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFBFCFE),
    surfaceContainer = Color(0xFFEFF3F8),
    surfaceContainerHigh = Color(0xFFE8EEF5),
    surfaceContainerHighest = Color(0xFFE1E8F1),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFDCE3EC),
    outline = Color(0xFFB6C2D2),
    outlineVariant = Color(0xFFDDE4EE),
    inverseSurface = Color(0xFF1E293B),
    inverseOnSurface = Color(0xFFF1F5F9),
    inversePrimary = Color(0xFF22D3EE),
    scrim = Color(0xFF000000),
)

/** Colors the Material scheme doesn't cover: session states and the graph-paper background. */
@Immutable
data class LabColors(
    val held: Color,
    val upcoming: Color,
    val missed: Color,
    val canceled: Color,
    val dayOff: Color,
    val dayOffContainer: Color,
    val gridMinor: Color,
    val gridMajor: Color,
    val glow: Color,
    val isDark: Boolean,
)

internal val ObservatoryLab = LabColors(
    held = Color(0xFF34D399),
    upcoming = Color(0xFF22D3EE),
    missed = Color(0xFFFBBF24),
    canceled = Color(0xFFF87171),
    dayOff = Color(0xFFFB7185),
    dayOffContainer = Color(0x33FB7185),
    gridMinor = Color(0x0D94A3B8),
    gridMajor = Color(0x1A94A3B8),
    glow = Color(0x2622D3EE),
    isDark = true,
)

internal val LabPaperLab = LabColors(
    held = Color(0xFF059669),
    upcoming = Color(0xFF0E7490),
    missed = Color(0xFFB45309),
    canceled = Color(0xFFC62828),
    dayOff = Color(0xFFE11D48),
    dayOffContainer = Color(0x1FE11D48),
    gridMinor = Color(0x120E7490),
    gridMajor = Color(0x200E7490),
    glow = Color(0x1A22D3EE),
    isDark = false,
)

val LocalLabColors = staticCompositionLocalOf { ObservatoryLab }

/**
 * School colors are named after groups of the periodic table, so each school reads as an
 * "element family" and its classes as elements of that family.
 */
object SchoolPalette {
    data class Group(val name: String, val dark: Color, val light: Color)

    val groups = listOf(
        Group("گاز نجیب", Color(0xFF22D3EE), Color(0xFF0891B2)),
        Group("لانتانید", Color(0xFFA78BFA), Color(0xFF7C3AED)),
        Group("نافلز", Color(0xFF34D399), Color(0xFF059669)),
        Group("قلیایی خاکی", Color(0xFFFBBF24), Color(0xFFB45309)),
        Group("قلیایی", Color(0xFFFB7185), Color(0xFFE11D48)),
        Group("فلز واسطه", Color(0xFF60A5FA), Color(0xFF2563EB)),
        Group("شبه‌فلز", Color(0xFFA3E635), Color(0xFF4D7C0F)),
        Group("هالوژن", Color(0xFFFB923C), Color(0xFFC2410C)),
    )

    fun color(index: Int, dark: Boolean): Color =
        groups[Math.floorMod(index, groups.size)].let { if (dark) it.dark else it.light }

    fun name(index: Int): String = groups[Math.floorMod(index, groups.size)].name
}
