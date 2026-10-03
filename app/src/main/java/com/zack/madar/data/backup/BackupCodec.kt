package com.zack.madar.data.backup

import com.zack.madar.data.db.DayOff
import com.zack.madar.data.db.School
import com.zack.madar.data.db.SchoolClass
import com.zack.madar.data.db.Session
import com.zack.madar.data.repo.Snapshot
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class BackupFile(
    val format: String = FORMAT,
    val version: Int = VERSION,
    val exportedAt: Long,
    val schools: List<School>,
    val classes: List<SchoolClass>,
    val sessions: List<Session>,
    val daysOff: List<DayOff>,
)

private const val FORMAT = "madar-backup"
private const val VERSION = 1

class InvalidBackupException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Reads and writes the JSON backup file; independent of Android so it can be unit-tested. */
object BackupCodec {

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encode(snapshot: Snapshot, exportedAt: Long = System.currentTimeMillis()): String =
        json.encodeToString(
            BackupFile.serializer(),
            BackupFile(
                exportedAt = exportedAt,
                schools = snapshot.schools,
                classes = snapshot.classes,
                sessions = snapshot.sessions,
                daysOff = snapshot.daysOff,
            ),
        )

    fun decode(text: String): Snapshot {
        val file = try {
            json.decodeFromString(BackupFile.serializer(), text)
        } catch (e: Exception) {
            throw InvalidBackupException("not a Madar backup", e)
        }
        if (file.format != FORMAT) throw InvalidBackupException("unexpected format ${file.format}")
        if (file.version > VERSION) throw InvalidBackupException("backup from a newer app version")

        val schoolIds = file.schools.mapTo(HashSet()) { it.id }
        val classIds = file.classes.mapTo(HashSet()) { it.id }
        if (file.classes.any { it.schoolId !in schoolIds } ||
            file.sessions.any { it.classId !in classIds } ||
            file.daysOff.any { it.schoolId != null && it.schoolId !in schoolIds }
        ) {
            throw InvalidBackupException("backup references missing records")
        }
        return Snapshot(file.schools, file.classes, file.sessions, file.daysOff)
    }
}
