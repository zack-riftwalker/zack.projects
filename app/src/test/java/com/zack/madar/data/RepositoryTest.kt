package com.zack.madar.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zack.madar.data.backup.BackupCodec
import com.zack.madar.data.backup.InvalidBackupException
import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.MadarDatabase
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.repo.MadarRepository
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
            listOf("هفتم ۱" to "۷۰۱", "هفتم ۲" to "۷۰۲"),
        )
        return schoolId
    }

    @Test
    fun batchAddKeepsOrderAndInheritsSchool() = runTest {
        val schoolId = seed()
        val snapshot = repo.snapshot.first()
        assertEquals(listOf("۷۰۱", "۷۰۲"), snapshot.classes.map { it.symbol })
        assertTrue(snapshot.classes.all { it.schoolId == schoolId && it.weekdaysOverride == null })
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
}
