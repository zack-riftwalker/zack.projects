package com.zack.madar.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zack.madar.ui.theme.Lab
import com.zack.madar.ui.theme.LabColors

/** Graph-paper grid with a soft glow in the top corner — the backdrop of every screen. */
fun Modifier.labGrid(colors: LabColors, cell: Dp = 16.dp): Modifier = drawBehind {
    drawRect(
        Brush.radialGradient(
            listOf(colors.glow, Color.Transparent),
            center = Offset(size.width * 0.9f, -size.width * 0.1f),
            radius = size.width * 1.1f,
        ),
    )
    val step = cell.toPx()
    var i = 0
    var x = 0f
    while (x <= size.width) {
        drawLine(if (i % 5 == 0) colors.gridMajor else colors.gridMinor, Offset(x, 0f), Offset(x, size.height), 1f)
        x += step
        i++
    }
    i = 0
    var y = 0f
    while (y <= size.height) {
        drawLine(if (i % 5 == 0) colors.gridMajor else colors.gridMinor, Offset(0f, y), Offset(size.width, y), 1f)
        y += step
        i++
    }
}

@Composable
fun LabBackground(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .background(MaterialTheme.colorScheme.background)
            .labGrid(Lab.colors),
    ) {
        CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground) { content() }
    }
}

/** A card on the grid: slightly translucent so the graph paper shows through. */
@Composable
fun LabCard(
    modifier: Modifier = Modifier,
    accent: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val shape = MaterialTheme.shapes.large
    val border = accent?.copy(alpha = 0.45f) ?: MaterialTheme.colorScheme.outlineVariant
    val container = MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = if (Lab.colors.isDark) 0.88f else 0.94f)
    if (onClick != null) {
        Surface(
            onClick = onClick,
            modifier = modifier.border(1.dp, border, shape),
            shape = shape,
            color = container,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) { content() }
    } else {
        Surface(
            modifier = modifier.border(1.dp, border, shape),
            shape = shape,
            color = container,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) { content() }
    }
}

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        action?.invoke()
    }
}

/** Instrument-style number + caption. */
@Composable
fun StatReadout(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.headlineMedium, color = color, fontWeight = FontWeight.Black)
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun SchoolDot(color: Color, modifier: Modifier = Modifier, size: Dp = 10.dp) {
    Box(modifier.size(size).background(color, CircleShape))
}

/** Small breathing dot used to flag "needs attention today". */
@Composable
fun PulsingDot(color: Color, modifier: Modifier = Modifier, size: Dp = 10.dp) {
    if (LocalInspectionMode.current) {
        Box(modifier.size(size * 2), contentAlignment = Alignment.Center) {
            Box(Modifier.size(size).background(color, CircleShape))
        }
        return
    }
    val transition = rememberInfiniteTransition(label = "pulse")
    val halo by transition.animateFloat(
        initialValue = 0.2f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Reverse),
        label = "halo",
    )
    Box(modifier.size(size * 2), contentAlignment = Alignment.Center) {
        Box(Modifier.size(size * 2).background(color.copy(alpha = halo * 0.35f), CircleShape))
        Box(Modifier.size(size).background(color, CircleShape))
    }
}

/** Pill-shaped label, e.g. «فصل ۳». */
@Composable
fun Tag(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = modifier
            .background(color.copy(alpha = 0.12f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/** A little molecule drawing for empty states. */
@Composable
fun MoleculeArt(modifier: Modifier = Modifier, primary: Color, secondary: Color, tertiary: Color) {
    Canvas(modifier) {
        val c = Offset(size.width / 2, size.height / 2)
        val r = size.minDimension
        val atoms = listOf(
            Triple(c, r * 0.13f, primary),
            Triple(c + Offset(-r * 0.30f, -r * 0.18f), r * 0.09f, secondary),
            Triple(c + Offset(r * 0.31f, -r * 0.16f), r * 0.08f, tertiary),
            Triple(c + Offset(r * 0.04f, r * 0.34f), r * 0.09f, secondary),
            Triple(c + Offset(-r * 0.36f, r * 0.24f), r * 0.055f, tertiary),
            Triple(c + Offset(r * 0.40f, r * 0.22f), r * 0.05f, primary),
        )
        val bonds = listOf(0 to 1, 0 to 2, 0 to 3, 1 to 4, 2 to 5)
        for ((a, b) in bonds) {
            drawLine(primary.copy(alpha = 0.45f), atoms[a].first, atoms[b].first, strokeWidth = r * 0.025f)
        }
        for ((center, radius, color) in atoms) {
            drawCircle(color.copy(alpha = 0.22f), radius * 1.6f, center)
            drawCircle(color, radius, center)
        }
        rotate(25f, c) {
            drawOval(
                primary.copy(alpha = 0.25f),
                topLeft = Offset(c.x - r * 0.48f, c.y - r * 0.16f),
                size = androidx.compose.ui.geometry.Size(r * 0.96f, r * 0.32f),
                style = Stroke(width = r * 0.012f),
            )
        }
    }
}

@Composable
fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MoleculeArt(
            Modifier.size(150.dp),
            primary = MaterialTheme.colorScheme.primary,
            secondary = MaterialTheme.colorScheme.secondary,
            tertiary = MaterialTheme.colorScheme.tertiary,
        )
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 340.dp),
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(8.dp))
            FilledTonalButton(onClick = onAction) { Text(actionLabel) }
        }
        if (secondaryLabel != null && onSecondary != null) {
            TextButton(onClick = onSecondary) { Text(secondaryLabel) }
        }
    }
}
