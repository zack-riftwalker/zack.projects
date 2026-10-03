package com.zack.madar.ui.classes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.zack.madar.data.db.School
import com.zack.madar.domain.format.PersianFormat
import com.zack.madar.ui.AppState
import com.zack.madar.ui.ClassOverview
import com.zack.madar.ui.components.AddElementTile
import com.zack.madar.ui.components.ElementTile
import com.zack.madar.ui.components.EmptyState
import com.zack.madar.ui.components.LabBackground
import com.zack.madar.ui.components.LabCard
import com.zack.madar.ui.components.SchoolDot
import com.zack.madar.ui.schoolColor
import com.zack.madar.ui.theme.SchoolPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassesScreen(
    state: AppState,
    onOpenClass: (Long) -> Unit,
    onAddClass: (schoolId: Long) -> Unit,
    onAddSchool: () -> Unit,
    onEditSchool: (Long) -> Unit,
) {
    var filter by rememberSaveable { mutableLongStateOf(0L) }
    val schools = state.snapshot.schools
    val overviews = state.overviews()
    val shownSchools = schools.filter { filter == 0L || it.id == filter }

    LabBackground(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = { Text("کلاس‌ها") },
                    actions = {
                        TextButton(onClick = onAddSchool) {
                            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("مدرسه")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                )
            },
            floatingActionButton = {
                if (schools.isNotEmpty()) {
                    ExtendedFloatingActionButton(
                        onClick = { onAddClass(if (filter != 0L) filter else schools.first().id) },
                        icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                        text = { Text("کلاس جدید") },
                    )
                }
            },
        ) { padding ->
            if (!state.loaded) return@Scaffold
            if (schools.isEmpty()) {
                EmptyState(
                    title = "هنوز مدرسه‌ای نداری",
                    body = "هر مدرسه مثل یک «خانواده»‌ی جدول تناوبیه و کلاس‌هاش عنصرهای اون خانواده‌ن.",
                    actionLabel = "افزودن مدرسه",
                    onAction = onAddSchool,
                    modifier = Modifier.padding(padding),
                )
                return@Scaffold
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(104.dp),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = padding.calculateTopPadding(),
                    bottom = padding.calculateBottomPadding() + 96.dp,
                ),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (schools.size > 1) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "filters") {
                        SchoolFilter(schools, filter) { filter = it }
                    }
                }
                for (school in shownSchools) {
                    val members = overviews.filter { it.schoolClass.schoolId == school.id }
                    item(span = { GridItemSpan(maxLineSpan) }, key = "header-${school.id}") {
                        SchoolHeader(school, members.size) { onEditSchool(school.id) }
                    }
                    items(members, key = { "class-${it.id}" }) { o ->
                        ClassTile(o) { onOpenClass(o.id) }
                    }
                    item(key = "add-${school.id}") {
                        AddElementTile("کلاس جدید", schoolColor(school.colorIndex), onClick = { onAddClass(school.id) })
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }, key = "legend") { Legend() }
            }
        }
    }
}

@Composable
private fun ClassTile(o: ClassOverview, onClick: () -> Unit) {
    ElementTile(
        symbol = o.schoolClass.symbol,
        name = o.schoolClass.name,
        number = o.stats.nextSessionNumber,
        caption = "${PersianFormat.digits(o.stats.remaining)} جلسه مانده",
        color = schoolColor(o.colorIndex),
        attention = o.needsAttention,
        onClick = onClick,
    )
}

@Composable
private fun SchoolFilter(schools: List<School>, selected: Long, onSelect: (Long) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            FilterChip(selected = selected == 0L, onClick = { onSelect(0L) }, label = { Text("همه") })
        }
        items(schools, key = { it.id }) { school ->
            FilterChip(
                selected = selected == school.id,
                onClick = { onSelect(school.id) },
                label = { Text(school.name) },
                leadingIcon = { SchoolDot(schoolColor(school.colorIndex)) },
            )
        }
    }
}

@Composable
private fun SchoolHeader(school: School, classCount: Int, onEdit: () -> Unit) {
    val color = schoolColor(school.colorIndex)
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        SchoolDot(color, size = 14.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(school.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            val days = school.weekdaySet.days().joinToString(" · ") { PersianFormat.weekdayName(it) }
            Text(
                "خانواده‌ی ${SchoolPalette.name(school.colorIndex)} · ${PersianFormat.digits(classCount)} کلاس · $days",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onEdit) {
            Icon(Icons.Filled.Edit, contentDescription = "ویرایش ${school.name}")
        }
    }
}

@Composable
private fun Legend() {
    LabCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            ElementTile(
                symbol = "۷۰۱",
                name = "",
                number = 12,
                caption = "۳ مانده",
                color = MaterialTheme.colorScheme.primary,
                compact = true,
                modifier = Modifier.size(76.dp),
            )
            Spacer(Modifier.width(14.dp))
            Column {
                Text("راهنمای کاشی‌ها", style = MaterialTheme.typography.titleSmall)
                Text(
                    "عدد گوشه = شماره‌ی جلسه‌ی بعدی\nوسط = نماد کلاس · پایین = جلسه‌های مانده تا آخر ماه\nنقطه‌ی نارنجی = امروز یا قبلاً ثبت نشده",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
