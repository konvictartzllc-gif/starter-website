# Dex Android App

This is the Android Studio project for Dex.

## Open It

1. Open Android Studio.
2. Choose `Open`.
3. Select this folder:
   `c:\Users\RACUser\starter website\android-app`
4. Let Android Studio sync the Gradle project.

## Build Environment

- If command-line Gradle says `JAVA_HOME is set to an invalid directory`, point `JAVA_HOME` to:
  `C:\Program Files\Android\Android Studio\jbr`
- `local.properties` should point `sdk.dir` at your Android SDK folder.
- After changing JDK or SDK paths, run:
  1. `File > Sync Project with Gradle Files`
  2. `Build > Clean Project`
  3. `Build > Rebuild Project`

## Project Defaults

- App name: `Dex`
- Package: `com.konvictartz.dex`
- Min SDK: `26`
- Target SDK: `34`

## Next Build Steps

- connect Dex login to your existing backend
- add phone permissions and call listener flow
- add RingCentral actions
- add Google Calendar OAuth
- add contact lookup and spam handling

Note: this repo did not already contain a Gradle wrapper. Android Studio can open this project structure and complete sync/setup from there.
