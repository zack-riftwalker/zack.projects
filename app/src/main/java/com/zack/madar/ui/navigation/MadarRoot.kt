package com.zack.madar.ui.navigation

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.zack.madar.R
import com.zack.madar.domain.calendar.toJalali
import com.zack.madar.ui.MadarViewModel
import com.zack.madar.ui.calendar.CalendarScreen
import com.zack.madar.ui.classdetail.ClassDetailScreen
import com.zack.madar.ui.classes.ClassesScreen
import com.zack.madar.ui.editclass.EditClassScreen
import com.zack.madar.ui.logsession.LogSessionSheet
import com.zack.madar.ui.school.EditSchoolScreen
import com.zack.madar.ui.settings.SettingsScreen
import com.zack.madar.ui.theme.MadarTheme
import com.zack.madar.ui.theme.isDarkTheme
import com.zack.madar.ui.timetable.TimetableScreen
import com.zack.madar.ui.today.TodayScreen
import kotlinx.serialization.Serializable
import kotlin.reflect.KClass

@Serializable object TodayRoute

@Serializable object ClassesRoute

@Serializable object CalendarRoute

@Serializable object TimetableRoute

@Serializable object SettingsRoute

@Serializable data class ClassDetailRoute(val classId: Long)

@Serializable data class EditClassRoute(val classId: Long = 0, val schoolId: Long = 0)

@Serializable data class EditSchoolRoute(val schoolId: Long = 0)

private data class Tab(val route: Any, val type: KClass<*>, val label: String, @DrawableRes val icon: Int)

private val tabs = listOf(
    Tab(TodayRoute, TodayRoute::class, "امروز", R.drawable.ic_atom),
    Tab(TimetableRoute, TimetableRoute::class, "برنامه", R.drawable.ic_timetable),
    Tab(ClassesRoute, ClassesRoute::class, "کلاس‌ها", R.drawable.ic_elements),
    Tab(CalendarRoute, CalendarRoute::class, "تقویم", R.drawable.ic_month),
)

@Composable
fun MadarRoot(vm: MadarViewModel, versionName: String, onDarkTheme: (Boolean) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val draft by vm.logDraft.collectAsStateWithLifecycle()
    val dark = isDarkTheme(state.settings.theme)
    SideEffect { onDarkTheme(dark) }

    MadarTheme(dark) {
        val nav = rememberNavController()
        val snackbar = remember { SnackbarHostState() }
        val resolver = LocalContext.current.contentResolver

        LaunchedEffect(vm) {
            vm.messages.collect { msg ->
                val result = snackbar.showSnackbar(
                    message = msg.text,
                    actionLabel = msg.actionLabel,
                    withDismissAction = false,
                    duration = if (msg.action != null) SnackbarDuration.Long else SnackbarDuration.Short,
                )
                if (result == SnackbarResult.ActionPerformed) vm.runUndo(msg)
            }
        }

        val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
            if (uri != null) vm.exportBackup(resolver, uri)
        }
        val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) vm.importBackup(resolver, uri)
        }

        val entry by nav.currentBackStackEntryAsState()
        val destination = entry?.destination
        val showBar = tabs.any { tab -> destination?.hasRoute(tab.type) == true }

        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            contentWindowInsets = WindowInsets(0),
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                if (showBar) {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                        for (tab in tabs) {
                            val selected = destination?.hierarchy?.any { it.hasRoute(tab.type) } == true
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    nav.navigate(tab.route) {
                                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(painterResource(tab.icon), contentDescription = null) },
                                label = { Text(tab.label) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = TodayRoute,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            ) {
                composable<TodayRoute> {
                    TodayScreen(
                        state = state,
                        onOpenClass = { nav.navigate(ClassDetailRoute(it)) },
                        onLog = { id, date -> vm.openLog(id, date) },
                        onEditToday = { o -> o.todaySessions.firstOrNull()?.let(vm::editSession) },
                        onMarkCanceled = vm::markCanceled,
                        onAddSchool = { nav.navigate(EditSchoolRoute()) },
                        onAddClass = { nav.navigate(EditClassRoute()) },
                        onOpenSettings = { nav.navigate(SettingsRoute) },
                    )
                }
                composable<ClassesRoute> {
                    ClassesScreen(
                        state = state,
                        onOpenClass = { nav.navigate(ClassDetailRoute(it)) },
                        onAddClass = { nav.navigate(EditClassRoute(schoolId = it)) },
                        onAddSchool = { nav.navigate(EditSchoolRoute()) },
                        onEditSchool = { nav.navigate(EditSchoolRoute(it)) },
                    )
                }
                composable<TimetableRoute> {
                    TimetableScreen(
                        state = state,
                        onOpenClass = { nav.navigate(ClassDetailRoute(it)) },
                        onEditClasses = {
                            nav.navigate(ClassesRoute) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                            }
                        },
                    )
                }
                composable<CalendarRoute> {
                    CalendarScreen(
                        state = state,
                        onOpenClass = { nav.navigate(ClassDetailRoute(it)) },
                        onLog = { id, date -> vm.openLog(id, date) },
                        onToggleDayOff = vm::toggleDayOff,
                    )
                }
                composable<ClassDetailRoute> { backStackEntry ->
                    val route = backStackEntry.toRoute<ClassDetailRoute>()
                    val back = dropUnlessResumed { nav.popBackStack() }
                    val cls = state.snapshot.classes.firstOrNull { it.id == route.classId }
                    ClassDetailScreen(
                        state = state,
                        classId = route.classId,
                        onBack = back,
                        onEdit = { nav.navigate(EditClassRoute(classId = route.classId)) },
                        onDelete = {
                            back()
                            cls?.let(vm::deleteClass)
                        },
                        onLog = { date -> vm.openLog(route.classId, date) },
                        onEditSession = vm::editSession,
                        onMarkCanceled = { date -> vm.markCanceled(route.classId, date) },
                    )
                }
                composable<EditClassRoute> { backStackEntry ->
                    val route = backStackEntry.toRoute<EditClassRoute>()
                    val back = dropUnlessResumed { nav.popBackStack() }
                    EditClassScreen(
                        state = state,
                        classId = route.classId,
                        initialSchoolId = route.schoolId,
                        onBack = back,
                        onAdd = { template, names ->
                            vm.addClasses(template, names)
                            back()
                        },
                        onUpdate = { cls, timetable ->
                            vm.updateClass(cls, timetable)
                            back()
                        },
                    )
                }
                composable<EditSchoolRoute> { backStackEntry ->
                    val route = backStackEntry.toRoute<EditSchoolRoute>()
                    val back = dropUnlessResumed { nav.popBackStack() }
                    EditSchoolScreen(
                        state = state,
                        schoolId = route.schoolId,
                        onBack = back,
                        onSave = { school ->
                            vm.saveSchool(school) { id ->
                                // The save finishes later; if the user already left this screen, don't navigate.
                                if (!backStackEntry.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                                    return@saveSchool
                                }
                                if (school.id == 0L) {
                                    // Natural next step after a new school: add its classes.
                                    nav.navigate(EditClassRoute(schoolId = id)) {
                                        popUpTo<EditSchoolRoute> { inclusive = true }
                                    }
                                } else {
                                    nav.popBackStack()
                                }
                            }
                        },
                        onDelete = {
                            vm.deleteSchool(it)
                            back()
                        },
                    )
                }
                composable<SettingsRoute> {
                    SettingsScreen(
                        state = state,
                        versionName = versionName,
                        onBack = dropUnlessResumed { nav.popBackStack() },
                        onTheme = vm::setTheme,
                        onCalendar = vm::setCalendar,
                        onExport = {
                            val j = state.today.toJalali()
                            exportLauncher.launch("madar-backup-${j.year}-${j.month}-${j.day}.json")
                        },
                        onImport = { importLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) },
                    )
                }
            }
        }

        draft?.let { d ->
            LogSessionSheet(
                initial = d,
                state = state,
                onDismiss = vm::dismissLog,
                onSubmit = vm::submitLog,
                onDelete = vm::deleteSession,
            )
        }
    }
}
