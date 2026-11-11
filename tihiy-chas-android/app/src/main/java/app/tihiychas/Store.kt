package app.tihiychas

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.Notification
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/** Хранилище на устройстве (SharedPreferences) + логика сессий. Всё локально. */
object Store {
    private const val URGENT = "срочно|авария|мама|прод упал|urgent"
    private val urgentRe = Regex(URGENT, RegexOption.IGNORE_CASE)
    const val CHANNEL = "digest"

    private fun p(c: Context) = c.getSharedPreferences("tihiy", Context.MODE_PRIVATE)

    // --- состояние текущей сессии ---
    fun endAt(c: Context) = p(c).getLong("endAt", 0)
    fun startAt(c: Context) = p(c).getLong("startAt", 0)
    fun planMin(c: Context) = p(c).getInt("plan", 25)
    fun distractions(c: Context) = p(c).getInt("dis", 0)
    fun isFocus(c: Context) = endAt(c) > System.currentTimeMillis()
    fun active(c: Context) = startAt(c) > 0

    fun addDistraction(c: Context) = p(c).edit().putInt("dis", distractions(c) + 1).apply()

    /** Адаптивная длина: по последним удачным сессиям (<=1 отвлечения). */
    fun plannedMinutes(c: Context): Int {
        val good = sessions(c).filter { it.done && it.dis <= 1 }.takeLast(5)
        if (good.size < 2) return 25
        val avg = good.map { it.plan }.average()
        return (Math.round((avg + 5) / 5) * 5).toInt().coerceIn(15, 50)
    }

    fun start(c: Context) {
        val plan = plannedMinutes(c)
        val now = System.currentTimeMillis()
        p(c).edit().putLong("startAt", now).putLong("endAt", now + plan * 60_000L)
            .putInt("plan", plan).putInt("dis", 0).apply()
        val am = c.getSystemService(AlarmManager::class.java)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, now + plan * 60_000L, alarmIntent(c))
    }

    /** Завершить сессию: записать в историю и выдать накопленные уведомления пачкой. */
    fun finish(c: Context, manual: Boolean) {
        if (!active(c)) return
        val start = startAt(c)
        val now = System.currentTimeMillis()
        val done = !manual
        val mins = if (done) planMin(c) else ((now - start) / 60_000).toInt()
        val arr = JSONArray(p(c).getString("sessions", "[]"))
        arr.put(JSONObject().put("t", start).put("plan", planMin(c)).put("mins", mins)
            .put("dis", distractions(c)).put("done", done))
        p(c).edit().putString("sessions", arr.toString())
            .putLong("startAt", 0).putLong("endAt", 0).apply()
        c.getSystemService(AlarmManager::class.java).cancel(alarmIntent(c))
        postDigest(c)
    }

    private fun alarmIntent(c: Context) = PendingIntent.getBroadcast(
        c, 1, Intent(c, SessionEndReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // --- очередь отложенных уведомлений ---
    fun isUrgent(text: String) = urgentRe.containsMatchIn(text)

    fun enqueue(c: Context, app: String, title: String, text: String) {
        val arr = JSONArray(p(c).getString("queue", "[]"))
        arr.put(JSONObject().put("app", app).put("title", title).put("text", text))
        p(c).edit().putString("queue", arr.toString()).apply()
    }

    fun queue(c: Context): List<String> {
        val arr = JSONArray(p(c).getString("queue", "[]"))
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it); "${o.getString("app")}: ${o.getString("title")} ${o.getString("text")}".trim()
        }
    }

    private fun postDigest(c: Context) {
        val items = queue(c)
        p(c).edit().putString("queue", "[]").apply()
        if (items.isEmpty()) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Пачка уведомлений", NotificationManager.IMPORTANCE_DEFAULT))
        val style = Notification.InboxStyle()
        items.takeLast(6).forEach { style.addLine(it) }
        val n = Notification.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Пока вы работали: ${items.size}")
            .setContentText(items.last()).setStyle(style).build()
        nm.notify(42, n)
    }

    // --- история и отчёт ---
    data class Session(val t: Long, val plan: Int, val mins: Int, val dis: Int, val done: Boolean)

    fun sessions(c: Context): List<Session> {
        val arr = JSONArray(p(c).getString("sessions", "[]"))
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Session(o.getLong("t"), o.getInt("plan"), o.getInt("mins"), o.getInt("dis"), o.getBoolean("done"))
        }
    }

    fun today(c: Context): List<Session> {
        val cal = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0) }
        return sessions(c).filter { it.t >= cal.timeInMillis }
    }

    fun hourly(c: Context): IntArray {
        val h = IntArray(24)
        today(c).forEach { s ->
            var t = s.t; var m = s.mins
            while (m > 0) {
                val hr = Calendar.getInstance().apply { timeInMillis = t }.get(Calendar.HOUR_OF_DAY)
                h[hr] += minOf(m, 60); t += 3_600_000L; m -= 60
            }
        }
        return h
    }
}

/** Срабатывает по окончании таймера, даже если приложение закрыто. */
class SessionEndReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent?) = Store.finish(c, manual = false)
}
