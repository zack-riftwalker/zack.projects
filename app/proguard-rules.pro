# kotlinx.serialization (backup format)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers @kotlinx.serialization.Serializable class com.zack.madar.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# Type-safe navigation routes are looked up through their serializers.
-keep class com.zack.madar.ui.navigation.*Route { *; }
-keep class com.zack.madar.ui.navigation.*Route$$serializer { *; }
