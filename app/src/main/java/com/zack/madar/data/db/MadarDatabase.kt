package com.zack.madar.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.zack.madar.domain.schedule.SessionStatus

@Database(
    entities = [School::class, SchoolClass::class, Session::class, DayOff::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class MadarDatabase : RoomDatabase() {
    abstract fun schoolDao(): SchoolDao
    abstract fun classDao(): ClassDao
    abstract fun sessionDao(): SessionDao
    abstract fun dayOffDao(): DayOffDao

    companion object {
        fun create(context: Context): MadarDatabase =
            Room.databaseBuilder(context, MadarDatabase::class.java, "madar.db").build()
    }
}

class Converters {
    @TypeConverter
    fun statusToString(status: SessionStatus): String = status.name

    @TypeConverter
    fun stringToStatus(value: String): SessionStatus = SessionStatus.valueOf(value)
}
