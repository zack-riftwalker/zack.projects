package com.zack.madar.data.db

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** v1 → v2: weekly timetable slots (day, period, odd/even week) and per-school week parity. */
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE schools ADD COLUMN flipParity INTEGER NOT NULL DEFAULT 0")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS class_slots (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, classId INTEGER NOT NULL, " +
                "dayOfWeek INTEGER NOT NULL, period INTEGER NOT NULL, repeat TEXT NOT NULL, " +
                "FOREIGN KEY(classId) REFERENCES classes(id) ON UPDATE NO ACTION ON DELETE CASCADE)",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_class_slots_classId ON class_slots (classId)")

        val schoolDays = HashMap<Long, Int>()
        db.query("SELECT id, weekdays FROM schools").use { c ->
            while (c.moveToNext()) schoolDays[c.getLong(0)] = c.getInt(1)
        }
        val classes = ArrayList<LegacySlots.LegacyClass>()
        db.query("SELECT id, schoolId, weekdaysOverride, sortOrder FROM classes").use { c ->
            while (c.moveToNext()) {
                classes += LegacySlots.LegacyClass(
                    id = c.getLong(0),
                    schoolId = c.getLong(1),
                    weekdaysOverride = if (c.isNull(2)) null else c.getInt(2),
                    sortOrder = c.getInt(3),
                )
            }
        }
        for (slot in LegacySlots.derive(schoolDays, classes)) {
            db.execSQL(
                "INSERT INTO class_slots (classId, dayOfWeek, period, repeat) VALUES (?, ?, ?, ?)",
                arrayOf<Any>(slot.classId, slot.dayOfWeek, slot.period, slot.repeat.name),
            )
        }
    }
}
