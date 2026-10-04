package com.zack.madar.data

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zack.madar.data.db.MIGRATION_1_2
import com.zack.madar.data.db.MadarDatabase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class MigrationTest {

    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), MadarDatabase::class.java)

    @Test
    fun v1WeekdaysBecomeTimetableSlots() {
        helper.createDatabase("migration-test", 1).apply {
            // Saturday (bit 5) + Sunday (bit 6).
            execSQL("INSERT INTO schools (id, name, colorIndex, weekdays, sortOrder) VALUES (1, 'الف', 0, 96, 0)")
            execSQL(
                "INSERT INTO classes (id, schoolId, name, symbol, grade, subject, weekdaysOverride, priorSessions, " +
                    "trackingStartEpochDay, archived, sortOrder) VALUES (1, 1, 'هفتم ۱', '۷۰۱', '', '', NULL, 2, 20719, 0, 0)",
            )
            execSQL(
                "INSERT INTO classes (id, schoolId, name, symbol, grade, subject, weekdaysOverride, priorSessions, " +
                    "trackingStartEpochDay, archived, sortOrder) VALUES (2, 1, 'هفتم ۲', '۷۰۲', '', '', 32, 0, 20719, 0, 1)",
            )
            execSQL("INSERT INTO sessions (id, classId, epochDay, status, topic, chapter, page, notes, createdAt) VALUES (1, 1, 20722, 'HELD', 'x', '', '', '', 0)")
            close()
        }

        val db = helper.runMigrationsAndValidate("migration-test", 2, true, MIGRATION_1_2)

        val slots = mutableListOf<Triple<Long, Int, Int>>()
        db.query("SELECT classId, dayOfWeek, period FROM class_slots ORDER BY classId, dayOfWeek").use { c ->
            while (c.moveToNext()) slots += Triple(c.getLong(0), c.getInt(1), c.getInt(2))
        }
        assertEquals(listOf(Triple(1L, 6, 1), Triple(1L, 7, 1), Triple(2L, 6, 2)), slots)
        db.query("SELECT COUNT(*) FROM sessions").use { c ->
            c.moveToFirst()
            assertEquals(1, c.getInt(0))
        }
    }
}
