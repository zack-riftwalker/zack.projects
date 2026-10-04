package com.zack.madar.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zack.madar.data.backup.BackupCodec
import com.zack.madar.data.backup.InvalidBackupException
import com.zack.madar.data.db.ClassSlot
import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.MadarDatabase
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.repo.MadarRepository
import com.zack.madar.data.repo.NewClass
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.time.DayOfWeek
import java.time.LocalDate

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class RepositoryTest {

    private lateinit var db: MadarDatabase
    private lateinit var repo: MadarRepository
    private val start = LocalDate.of(2026, 9, 23).toEpochDay()

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), MadarDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = MadarRepository(db)
    }

    @After
    fun tearDown() = db.close()

    private suspend fun seed(): Long {
        val schoolId = repo.saveSchool(
            School(name = "دبیرستان فردوسی", colorIndex = 0, weekdays = WeekdaySet.of(DayOfWeek.SATURDAY).bits),
        )
        repo.addClasses(
            SchoolClass(schoolId = schoolId, name = "", symbol = "", grade = "هفتم", trackingStartEpochDay = start),
            listOf(
                NewClass("هفتم ۱", "۷۰۱", listOf(ClassSlot(classId = 0, dayOfWeek = 6, period = 1))),
                NewClass("هفتم ۲", "۷۰۲", listOf(ClassSlot(classId = 0, dayOfWeek = 6, period = 2, repeat = WeekRepeat.ODD))),
            ),
        )
        return schoolId
    }

    @Test
    fun batchAddKeepsOrderAndInheritsSchool() = runTest {
        val schoolId = seed()
        val snapshot = repo.snapshot.first()
        assertEquals(listOf("۷۰۱", "۷۰۲"), snapshot.classes.map { it.symbol })
        assertTrue(snapshot.classes.all { it.schoolId == schoolId })
        val second = snapshot.classes[1]
        assertEquals(listOf(2 to WeekRepeat.ODD), snapshot.slotsOf(second.id).map { it.period to it.repeat })
        assertEquals(listOf(0, 1), snapshot.classes.map { it.sortOrder })
    }

    @Test
    fun deletingAClassCanBeUndone() = runTest {
        seed()
        val cls = repo.snapshot.first().classes.first()
        repo.saveSession(Session(classId = cls.id, epochDay = start + 3, topic = "فصل ۱"))

        val deleted = repo.deleteClass(cls)
        assertTrue(repo.snapshot.first().sessions.isEmpty())

        repo.restoreClass(deleted)
        val restored = repo.snapshot.first()
        assertEquals(2, restored.classes.size)
        assertEquals("فصل ۱", restored.sessions.single().topic)
    }

    @Test
    fun deletingASchoolCascades() = runTest {
        val schoolId = seed()
        repo.addDayOff(DayOff(epochDay = start, schoolId = schoolId))
        repo.addDayOff(DayOff(epochDay = start + 1))
        repo.deleteSchool(repo.snapshot.first().school(schoolId)!!)
        val snapshot = repo.snapshot.first()
        assertTrue(snapshot.classes.isEmpty())
        assertEquals(1, snapshot.daysOff.size)
    }

    @Test
    fun togglingADayOffAddsThenRemovesIt() = runTest {
        val schoolId = seed()
        assertTrue(repo.toggleDayOff(start, null))
        assertTrue(repo.toggleDayOff(start, schoolId))
        assertEquals(2, repo.snapshot.first().daysOff.size)

        // The global holiday is matched separately from the school-specific one.
        assertEquals(false, repo.toggleDayOff(start, null))
        assertEquals(listOf<Long?>(schoolId), repo.snapshot.first().daysOff.map { it.schoolId })
    }

    @Test
    fun backupRoundTripReplacesEverything() = runTest {
        seed()
        val cls = repo.snapshot.first().classes.first()
        repo.saveSession(Session(classId = cls.id, epochDay = start + 3, topic = "جانداران", page = "۱۲"))
        repo.addDayOff(DayOff(epochDay = start + 10, reason = "تعطیل رسمی"))
        val original = repo.snapshot.first()

        val json = BackupCodec.encode(original, exportedAt = 0)
        repo.saveSchool(School(name = "موقت", colorIndex = 1, weekdays = 0))

        repo.replaceAll(BackupCodec.decode(json))
        val restored = repo.snapshot.first()
        assertEquals(original.schools, restored.schools)
        assertEquals(original.classes, restored.classes)
        assertEquals(original.sessions, restored.sessions)
        assertEquals(original.daysOff, restored.daysOff)
    }

    @Test(expected = InvalidBackupException::class)
    fun rejectsForeignJson() {
        BackupCodec.decode("""{"hello": "world"}""")
    }

    @Test
    fun deletingAClassRestoresItsTimetableOnUndo() = runTest {
        seed()
        val cls = repo.snapshot.first().classes.first()
        val deleted = repo.deleteClass(cls)
        assertTrue(repo.snapshot.first().slots.none { it.classId == cls.id })
        repo.restoreClass(deleted)
        assertEquals(1, repo.snapshot.first().slotsOf(cls.id).size)
    }

    @Test
    fun updatingAClassReplacesItsTimetable() = runTest {
        seed()
        val cls = repo.snapshot.first().classes.first()
        repo.updateClass(
            cls.copy(name = "هفتم الف"),
            listOf(
                ClassSlot(classId = 0, dayOfWeek = 6, period = 3),
                ClassSlot(classId = 0, dayOfWeek = 2, period = 1, repeat = WeekRepeat.EVEN),
            ),
        )
        val snapshot = repo.snapshot.first()
        assertEquals("هفتم الف", snapshot.classes.first { it.id == cls.id }.name)
        assertEquals(setOf(3, 1), snapshot.slotsOf(cls.id).map { it.period }.toSet())
    }

    @Test
    fun versionOneBackupGetsTimetableFromWeekdays() {
        val v1 = """
            {"format":"madar-backup","version":1,"exportedAt":0,
             "schools":[{"id":1,"name":"الف","colorIndex":0,"weekdays":96,"sortOrder":0}],
             "classes":[
               {"id":1,"schoolId":1,"name":"هفتم ۱","symbol":"۷۰۱","trackingStartEpochDay":20719,"sortOrder":0},
               {"id":2,"schoolId":1,"name":"هفتم ۲","symbol":"۷۰۲","weekdaysOverride":32,"trackingStartEpochDay":20719,"sortOrder":1}],
             "sessions":[],"daysOff":[]}
        """.trimIndent()
        val snapshot = BackupCodec.decode(v1)
        // School days 96 = Saturday (bit 5) + Sunday (bit 6); class 2 overrides with Saturday only.
        assertEquals(setOf(6 to 1, 7 to 1), snapshot.slotsOf(1).map { it.dayOfWeek to it.period }.toSet())
        assertEquals(listOf(6 to 2), snapshot.slotsOf(2).map { it.dayOfWeek to it.period })
    }
}
