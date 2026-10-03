package com.zack.madar.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface SchoolDao {
    @Query("SELECT * FROM schools ORDER BY sortOrder, id")
    fun observeAll(): Flow<List<School>>

    @Query("SELECT * FROM schools WHERE id = :id")
    suspend fun get(id: Long): School?

    @Query("SELECT COALESCE(MAX(sortOrder), -1) + 1 FROM schools")
    suspend fun nextSortOrder(): Int

    @Insert
    suspend fun insert(school: School): Long

    @Insert
    suspend fun insertAll(schools: List<School>)

    @Update
    suspend fun update(school: School)

    @Delete
    suspend fun delete(school: School)

    @Query("DELETE FROM schools")
    suspend fun deleteAll()
}

@Dao
interface ClassDao {
    @Query("SELECT * FROM classes ORDER BY sortOrder, id")
    fun observeAll(): Flow<List<SchoolClass>>

    @Query("SELECT * FROM classes WHERE id = :id")
    suspend fun get(id: Long): SchoolClass?

    @Query("SELECT COALESCE(MAX(sortOrder), -1) + 1 FROM classes")
    suspend fun nextSortOrder(): Int

    @Insert
    suspend fun insert(schoolClass: SchoolClass): Long

    @Insert
    suspend fun insertAll(classes: List<SchoolClass>)

    @Update
    suspend fun update(schoolClass: SchoolClass)

    @Delete
    suspend fun delete(schoolClass: SchoolClass)
}

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY epochDay, id")
    fun observeAll(): Flow<List<Session>>

    @Query("SELECT * FROM sessions WHERE id = :id")
    suspend fun get(id: Long): Session?

    @Query("SELECT * FROM sessions WHERE classId = :classId")
    suspend fun forClass(classId: Long): List<Session>

    @Insert
    suspend fun insert(session: Session): Long

    @Insert
    suspend fun insertAll(sessions: List<Session>)

    @Update
    suspend fun update(session: Session)

    @Delete
    suspend fun delete(session: Session)
}

@Dao
interface DayOffDao {
    @Query("SELECT * FROM days_off ORDER BY epochDay")
    fun observeAll(): Flow<List<DayOff>>

    /** `IS` so a null [schoolId] matches the global (all-schools) holiday. */
    @Query("SELECT * FROM days_off WHERE epochDay = :epochDay AND schoolId IS :schoolId LIMIT 1")
    suspend fun find(epochDay: Long, schoolId: Long?): DayOff?

    @Insert
    suspend fun insert(dayOff: DayOff): Long

    @Insert
    suspend fun insertAll(daysOff: List<DayOff>)

    @Delete
    suspend fun delete(dayOff: DayOff)

    @Query("DELETE FROM days_off")
    suspend fun deleteAll()
}
