package com.zack.madar.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zack.madar.domain.schedule.SlotState
import com.zack.madar.ui.theme.Lab
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * The month as an atom: every session of the month is an electron on the orbit.
 * Filled = held, ring = still to come, amber = past but not logged, red = canceled.
 * The nucleus shows a headline number (usually sessions left).
 */
@Composable
fun OrbitProgress(
    slots: List<SlotState>,
    accent: Color,
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    description: String = "$value $label",
) {
    val lab = Lab.colors
    val electrons = remember(slots) { slots.filter { it != SlotState.DAY_OFF } }
    // Previews and screenshot tests get a still frame; infinite animations never go idle.
    val still = LocalInspectionMode.current
    val reveal = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(electrons.size) {
        reveal.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
    }
    var spin = 0f
    var pulse = 0.6f
    if (!still) {
        val transition = rememberInfiniteTransition(label = "orbit")
        spin = transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(90_000, easing = LinearEasing), RepeatMode.Restart),
            label = "spin",
        ).value
        pulse = transition.animateFloat(
            initialValue = 0.25f,
            targetValue = 0.85f,
            animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse),
            label = "pulse",
        ).value
    }
    val ring = MaterialTheme.colorScheme.outlineVariant
    val hole = MaterialTheme.colorScheme.surfaceContainerLow

    Box(modifier.semantics(mergeDescendants = true) { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val radius = min(size.width, size.height) / 2f
            val electronR = (radius * if (electrons.size > 14) 0.075f else 0.09f).coerceAtMost(7.dp.toPx())
            val orbitR = radius - electronR * 1.8f
            val c = center

            // Decorative tilted orbits make it read as an atom.
            for (angle in listOf(60f, -60f)) {
                rotate(angle + spin, c) {
                    drawOval(
                        ring.copy(alpha = 0.9f),
                        topLeft = Offset(c.x - orbitR, c.y - orbitR * 0.34f),
                        size = Size(orbitR * 2, orbitR * 0.68f),
                        style = Stroke(1.dp.toPx()),
                    )
                }
            }
            drawCircle(accent.copy(alpha = 0.35f), orbitR, c, style = Stroke(1.5.dp.toPx()))

            // Nucleus.
            drawCircle(accent.copy(alpha = 0.10f), orbitR * 0.56f, c)
            drawCircle(accent.copy(alpha = 0.45f), orbitR * 0.56f, c, style = Stroke(1.dp.toPx()))

            val n = electrons.size
            if (n == 0) return@Canvas
            val visible = (n * reveal.value).toInt().coerceAtMost(n)
            for (i in 0 until visible) {
                // Start at 12 o'clock and go clockwise.
                val theta = -PI / 2 + 2 * PI * i / n
                val p = Offset(c.x + orbitR * cos(theta).toFloat(), c.y + orbitR * sin(theta).toFloat())
                drawElectron(electrons[i], p, electronR, accent, lab.missed, lab.canceled, hole, pulse)
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black, color = accent)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun DrawScope.drawElectron(
    state: SlotState,
    p: Offset,
    r: Float,
    accent: Color,
    missed: Color,
    canceled: Color,
    hole: Color,
    pulse: Float,
) {
    when (state) {
        SlotState.HELD, SlotState.EXTRA -> {
            drawCircle(accent.copy(alpha = 0.25f), r * 1.7f, p)
            drawCircle(accent, r, p)
        }
        SlotState.UPCOMING -> {
            drawCircle(hole, r, p)
            drawCircle(accent.copy(alpha = 0.8f), r * 0.85f, p, style = Stroke(r * 0.35f))
        }
        SlotState.TODAY -> {
            drawCircle(accent.copy(alpha = pulse * 0.4f), r * 2.1f, p)
            drawCircle(hole, r, p)
            drawCircle(accent, r, p, style = Stroke(r * 0.5f))
        }
        SlotState.MISSED -> {
            drawCircle(missed.copy(alpha = 0.25f), r * 1.6f, p)
            drawCircle(missed, r * 0.9f, p)
        }
        SlotState.CANCELED -> {
            drawCircle(hole, r, p)
            val d = r * 0.6f
            drawLine(canceled.copy(alpha = 0.8f), p + Offset(-d, -d), p + Offset(d, d), r * 0.35f)
            drawLine(canceled.copy(alpha = 0.8f), p + Offset(-d, d), p + Offset(d, -d), r * 0.35f)
        }
        SlotState.DAY_OFF -> Unit
    }
}
