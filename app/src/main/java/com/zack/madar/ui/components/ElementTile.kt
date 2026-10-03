package com.zack.madar.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.ui.theme.Lab

/**
 * A class drawn as a periodic-table element:
 *  • top corner — "atomic number" = the number of the next session,
 *  • centre — the class symbol (e.g. ۷۰۱),
 *  • bottom — the class name and how many sessions are left this month.
 */
@Composable
fun ElementTile(
    symbol: String,
    name: String,
    number: Int,
    caption: String,
    color: Color,
    modifier: Modifier = Modifier,
    attention: Boolean = false,
    compact: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(if (compact) 12.dp else 16.dp)
    val surface = MaterialTheme.colorScheme.surfaceContainerLow
    val tint = color.copy(alpha = if (Lab.colors.isDark) 0.13f else 0.09f).compositeOver(surface)
    val description = "کلاس $name، جلسه‌ی بعد ${PersianFormat.digits(number)}، $caption"

    val content: @Composable () -> Unit = {
        Column(
            Modifier.fillMaxSize().padding(if (compact) 6.dp else 10.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    PersianFormat.digits(number),
                    style = if (compact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelLarge,
                    color = color,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                if (attention) PulsingDot(Lab.colors.missed, size = if (compact) 5.dp else 7.dp)
            }
            Text(
                symbol,
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontSize = symbolSize(symbol, compact),
                    lineHeight = symbolSize(symbol, compact) * 1.15f,
                ),
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                if (!compact) {
                    Text(
                        name,
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    caption,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }

    val tileModifier = modifier
        .aspectRatio(if (compact) 1f else 0.86f)
        .semantics(mergeDescendants = true) { contentDescription = description }
    val border = BorderStroke(1.2.dp, color.copy(alpha = 0.6f))
    val onSurface = MaterialTheme.colorScheme.onSurface
    if (onClick != null) {
        Surface(onClick = onClick, modifier = tileModifier, shape = shape, color = tint, contentColor = onSurface, border = border, content = content)
    } else {
        Surface(modifier = tileModifier, shape = shape, color = tint, contentColor = onSurface, border = border, content = content)
    }
}

private fun symbolSize(symbol: String, compact: Boolean): TextUnit {
    val base = if (compact) 18 else 28
    return when {
        symbol.length <= 3 -> base.sp
        symbol.length == 4 -> (base * 0.82f).sp
        else -> (base * 0.68f).sp
    }
}

/** Dashed "empty slot" tile that adds a class. */
@Composable
fun AddElementTile(label: String, color: Color, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Surface(
        onClick = onClick,
        modifier = modifier
            .aspectRatio(0.86f)
            .drawBehind {
                drawRoundRect(
                    color = color.copy(alpha = 0.6f),
                    style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))),
                    cornerRadius = CornerRadius(16.dp.toPx()),
                )
            },
        shape = shape,
        color = Color.Transparent,
    ) {
        Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = color)
            Text(label, style = MaterialTheme.typography.labelMedium, color = color)
        }
    }
}

/** A tiny square swatch in the school's colour with its symbol, for list rows. */
@Composable
fun MiniElement(symbol: String, color: Color, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val surface = MaterialTheme.colorScheme.surfaceContainerLow
    Box(
        modifier
            .size(size)
            .border(1.2.dp, color.copy(alpha = 0.65f), RoundedCornerShape(10.dp))
            .drawBehind {
                drawRoundRect(
                    color.copy(alpha = 0.14f).compositeOver(surface),
                    cornerRadius = CornerRadius(10.dp.toPx()),
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            symbol,
            style = MaterialTheme.typography.labelLarge.copy(fontSize = if (symbol.length <= 3) 15.sp else 12.sp),
            fontWeight = FontWeight.Black,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
    }
}
