package com.zack.madar.data.repo

import androidx.room.withTransaction
import com.zack.madar.data.db.ClassSlot
import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.MadarDatabase
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.domain.schedule.ClassPlan
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.time.LocalDate

/** Everything the app stores, as one consistent picture. The data set is small, so screens derive from it. */
data class Snapshot(
    val schools: List<School> = emptyList(),
    val classes: List<SchoolClass> = emptyList(),
    val sessions: List<Session> = emptyList(),
    val daysOff: List<DayOff> = emptyList(),
    val slots: List<ClassSlot> = emptyList(),
) {
    private val schoolsById by lazy { schools.associateBy { it.id } }
    private val sessionsByClass by lazy { sessions.groupBy { it.classId } }
    private val slotsByClass by lazy { slots.groupBy { it.classId } }

    fun slotsOf(classId: Long): List<ClassSlot> = slotsByClass[classId].orEmpty()

    fun planOf(c: SchoolClass): ClassPlan = c.plan(school(c.schoolId), slotsOf(c.id))

    fun school(id: Long): School? = schoolsById[id]

    fun sessionsOf(classId: Long): List<Session> = sessionsByClass[classId].orEmpty()

    fun daysOffFor(schoolId: Long): Set<LocalDate> =
        daysOff.filter { it.appliesTo(schoolId) }.mapTo(HashSet()) { it.date }

    val activeClasses: List<SchoolClass> get() = classes.filterNot { it.archived }
}

/** A class to create: its name, tile symbol and weekly timetable. */
data class NewClass(val name: String, val symbol: String, val slots: List<ClassSlot>)

/** A deleted class together with its sessions and timetable, so the deletion can be undone. */
data class DeletedClass(val schoolClass: SchoolClass, val sessions: List<Session>, val slots: List<ClassSlot>)

class MadarRepository(private val db: MadarDatabase) {

    private val schools = db.schoolDao()
    private val classes = db.classDao()
    private val sessions = db.sessionDao()
    private val daysOff = db.dayOffDao()
    private val slots = db.slotDao()

    val snapshot: Flow<Snapshot> = combine(
        schools.observeAll(),
        classes.observeAll(),
        sessions.observeAll(),
        daysOff.observeAll(),
        slots.observeAll(),
    ) { s, c, ses, off, sl -> Snapshot(s, c, ses, off, sl) }

    // Schools

    suspend fun saveSchool(school: School): Long =
        if (school.id == 0L) {
            schools.insert(school.copy(sortOrder = schools.nextSortOrder()))
        } else {
            schools.update(school)
            school.id
        }

    suspend fun deleteSchool(school: School) = schools.delete(school)

    // Classes

    /** Adds one class per entry; each comes with its own weekly timetable (classId is filled in here). */
    suspend fun addClasses(template: SchoolClass, entries: List<NewClass>) = db.withTransaction {
        var order = classes.nextSortOrder()
        for (e in entries) {
            val id = classes.insert(template.copy(id = 0, name = e.name, symbol = e.symbol, sortOrder = order++))
            slots.insertAll(e.slots.map { it.copy(id = 0, classId = id) })
        }
    }

    suspend fun updateClass(schoolClass: SchoolClass, timetable: List<ClassSlot>) = db.withTransaction {
        classes.update(schoolClass)
        slots.deleteForClass(schoolClass.id)
        slots.insertAll(timetable.map { it.copy(id = 0, classId = schoolClass.id) })
    }

    suspend fun deleteClass(schoolClass: SchoolClass): DeletedClass = db.withTransaction {
        val owned = sessions.forClass(schoolClass.id)
        val timetable = slots.forClass(schoolClass.id)
        classes.delete(schoolClass)
        DeletedClass(schoolClass, owned, timetable)
    }

    suspend fun restoreClass(deleted: DeletedClass) = db.withTransaction {
        classes.insert(deleted.schoolClass)
        sessions.insertAll(deleted.sessions)
        slots.insertAll(deleted.slots)
    }

    // Sessions

    suspend fun saveSession(session: Session): Long =
        if (session.id == 0L) {
            sessions.insert(session.copy(createdAt = System.currentTimeMillis()))
        } else {
            sessions.update(session)
            session.id
        }

    suspend fun deleteSession(session: Session) = sessions.delete(session)

    suspend fun restoreSession(session: Session) {
        sessions.insert(session)
    }

    // Days off

    suspend fun addDayOff(dayOff: DayOff): Long = daysOff.insert(dayOff)

    suspend fun deleteDayOff(dayOff: DayOff) = daysOff.delete(dayOff)

    /**
     * Adds the holiday if it isn't there, otherwise removes it; returns true when added.
     * Checked inside the transaction so quick repeated taps can't stack duplicate rows.
     */
    suspend fun toggleDayOff(epochDay: Long, schoolId: Long?): Boolean = db.withTransaction {
        val existing = daysOff.find(epochDay, schoolId)
        if (existing != null) {
            daysOff.delete(existing)
            false
        } else {
            daysOff.insert(DayOff(epochDay = epochDay, schoolId = schoolId))
            true
        }
    }

    // Backup

    suspend fun replaceAll(data: Snapshot) = db.withTransaction {
        // Cascades remove classes, sessions and school-specific days off; global days off are cleared separately.
        schools.deleteAll()
        daysOff.deleteAll()
        schools.insertAll(data.schools)
        classes.insertAll(data.classes)
        sessions.insertAll(data.sessions)
        daysOff.insertAll(data.daysOff)
        slots.insertAll(data.slots)
    }
}
