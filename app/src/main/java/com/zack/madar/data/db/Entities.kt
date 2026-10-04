package com.zack.madar.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.zack.madar.domain.schedule.ClassPlan
import com.zack.madar.domain.schedule.SchoolWeek
import com.zack.madar.domain.schedule.SessionRecord
import com.zack.madar.domain.schedule.SessionStatus
import com.zack.madar.domain.schedule.WeekRepeat
import com.zack.madar.domain.schedule.WeekdaySet
import com.zack.madar.domain.schedule.WeeklySlot
import kotlinx.serialization.Serializable
import java.time.DayOfWeek
import java.time.LocalDate

@Serializable
@Entity(tableName = "schools")
data class School(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    /** Index into the "element group" palette, see `SchoolPalette`. */
    val colorIndex: Int,
    /** [WeekdaySet] bits: the days the teacher is at this school. */
    val weekdays: Int,
    val sortOrder: Int = 0,
    /** This school numbers odd/even weeks the other way round, see [SchoolWeek.isOdd]. */
    @ColumnInfo(defaultValue = "0")
    val flipParity: Boolean = false,
) {
    val weekdaySet: WeekdaySet get() = WeekdaySet(weekdays)
}

@Serializable
@Entity(
    tableName = "classes",
    foreignKeys = [
        ForeignKey(School::class, ["id"], ["schoolId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("schoolId")],
)
data class SchoolClass(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val schoolId: Long,
    /** e.g. «هفتم ۱» */
    val name: String,
    /** Short label shown on the element tile, e.g. «۷۰۱». */
    val symbol: String,
    /** Grade/level, used to suggest topics from sibling classes, e.g. «هفتم». */
    val grade: String = "",
    val subject: String = "",
    /** Unused since schema v2 (the timetable lives in [ClassSlot]); kept so old rows and backups still load. */
    val weekdaysOverride: Int? = null,
    /** Sessions taught before the teacher started tracking this class in the app. */
    val priorSessions: Int = 0,
    /** Epoch day from which unlogged scheduled days count as "missed". */
    val trackingStartEpochDay: Long,
    val archived: Boolean = false,
    val sortOrder: Int = 0,
) {
    val trackingStart: LocalDate get() = LocalDate.ofEpochDay(trackingStartEpochDay)

    fun plan(school: School?, slots: List<ClassSlot>) = ClassPlan(
        slots = slots.map { it.toWeeklySlot() },
        trackingStart = trackingStart,
        priorSessions = priorSessions,
        flipParity = school?.flipParity ?: false,
    )
}

/** One entry of a class's weekly timetable: day, period (زنگ) and odd/even weeks. */
@Serializable
@Entity(
    tableName = "class_slots",
    foreignKeys = [
        ForeignKey(SchoolClass::class, ["id"], ["classId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("classId")],
)
data class ClassSlot(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val classId: Long,
    /** ISO day of week, 1 = Monday … 7 = Sunday. */
    val dayOfWeek: Int,
    /** زنگ, starting at 1. */
    val period: Int,
    val repeat: WeekRepeat = WeekRepeat.EVERY,
) {
    val day: DayOfWeek get() = DayOfWeek.of(dayOfWeek)

    fun toWeeklySlot() = WeeklySlot(day, period, repeat)
}

@Serializable
@Entity(
    tableName = "sessions",
    foreignKeys = [
        ForeignKey(SchoolClass::class, ["id"], ["classId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("classId"), Index("epochDay")],
)
data class Session(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val classId: Long,
    val epochDay: Long,
    val status: SessionStatus = SessionStatus.HELD,
    /** «تا کجا درس دادم» */
    val topic: String = "",
    val chapter: String = "",
    val page: String = "",
    val notes: String = "",
    val createdAt: Long = 0,
) {
    val date: LocalDate get() = LocalDate.ofEpochDay(epochDay)

    fun toRecord() = SessionRecord(id, date, status)
}

/** A holiday: for every school when [schoolId] is null, otherwise only for that school. */
@Serializable
@Entity(
    tableName = "days_off",
    foreignKeys = [
        ForeignKey(School::class, ["id"], ["schoolId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("schoolId"), Index("epochDay")],
)
data class DayOff(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val epochDay: Long,
    val schoolId: Long? = null,
    val reason: String = "",
) {
    val date: LocalDate get() = LocalDate.ofEpochDay(epochDay)

    fun appliesTo(school: Long): Boolean = schoolId == null || schoolId == school
}
