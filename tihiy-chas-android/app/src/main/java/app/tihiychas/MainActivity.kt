package app.tihiychas

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var state: TextView
    private lateinit var time: TextView
    private lateinit var hint: TextView
    private lateinit var access: TextView
    private lateinit var queue: TextView
    private lateinit var stats: TextView
    private lateinit var tip: TextView
    private lateinit var heat: LinearLayout
    private lateinit var startBtn: Button

    private val loop = object : Runnable {
        override fun run() { refresh(); ui.postDelayed(this, 1000) }
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(24), dp(16), dp(16))
        }
        fun text(size: Float, color: Int = Color.WHITE, bold: Boolean = false) = TextView(this).apply {
            textSize = size; setTextColor(color); if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        root.addView(text(22f, bold = true).apply { this.text = "🎧 Тихий час" })

        state = text(14f, Color.GRAY).apply { gravity = Gravity.CENTER }
        time = text(56f, bold = true).apply { gravity = Gravity.CENTER }
        hint = text(14f, Color.GRAY).apply { gravity = Gravity.CENTER }
        startBtn = Button(this).apply { setOnClickListener { toggle() } }
        val distract = Button(this).apply {
            text = "Отвлёкся (+1)"; setOnClickListener { if (Store.active(context)) Store.addDistraction(context) }
        }
        root.addView(card(state, time, hint, startBtn, distract))

        access = text(14f, Color.parseColor("#fbbf24")).apply {
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        queue = text(13f, Color.LTGRAY)
        root.addView(card(text(14f, Color.GRAY).apply { this.text = "Отложенные уведомления" }, access, queue))

        stats = text(18f, Color.parseColor("#6ee7b7"), true)
        heat = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        tip = text(14f, Color.LTGRAY)
        root.addView(card(text(14f, Color.GRAY).apply { this.text = "Отчёт за сегодня" }, stats,
            text(12f, Color.GRAY).apply { this.text = "Карта внимания по часам (0–23)" }, heat, tip))

        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#10131a")); addView(root) })
    }

    override fun onResume() { super.onResume(); ui.post(loop) }
    override fun onPause() { super.onPause(); ui.removeCallbacks(loop) }

    private fun toggle() {
        if (Store.active(this)) Store.finish(this, manual = true) else Store.start(this)
        refresh()
    }

    private fun refresh() {
        // сессия могла закончиться, пока приложение было закрыто или будильник не сработал
        if (Store.active(this) && !Store.isFocus(this)) Store.finish(this, manual = false)

        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?.contains(packageName) == true
        access.text = if (enabled) "✅ Доступ к уведомлениям выдан"
        else "⚠️ Нужен доступ к уведомлениям — нажмите, чтобы включить"

        if (Store.active(this)) {
            val left = ((Store.endAt(this) - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
            state.text = "🔕 Тихий режим включён"
            time.text = "%02d:%02d".format(left / 60, left % 60)
            hint.text = "Отвлечений: ${Store.distractions(this)}"
            startBtn.text = "Завершить"
        } else {
            state.text = "Готов к фокусу"
            time.text = "%02d:00".format(Store.plannedMinutes(this))
            hint.text = "Адаптивная длина сессии: ${Store.plannedMinutes(this)} мин"
            startBtn.text = "Старт"
        }

        val q = Store.queue(this)
        queue.text = if (q.isEmpty()) "Пусто" else "Ждут: ${q.size}\n" + q.takeLast(5).joinToString("\n") { "• $it" }

        val s = Store.today(this)
        stats.text = "${s.sumOf { it.mins }} мин · ${s.size} сессий · ${s.sumOf { it.dis }} отвлечений"
        val h = Store.hourly(this); val mx = (h.maxOrNull() ?: 0).coerceAtLeast(1)
        heat.removeAllViews()
        h.forEach { v ->
            val a = if (v == 0) 0x22 else (0x40 + 0xBF * v / mx)
            val cell = View(this).apply { setBackgroundColor(Color.argb(a, 110, 231, 183)) }
            heat.addView(cell, LinearLayout.LayoutParams(0, dp(14), 1f).apply { setMargins(1, 0, 1, 0) })
        }
        val tot = s.sumOf { it.mins }
        tip.text = when {
            s.isEmpty() -> "Запустите первую сессию, чтобы получить совет."
            s.sumOf { it.dis } / s.size > 2 -> "Много отвлечений: попробуйте сессии покороче и уберите телефон из виду."
            tot >= 90 -> "Отличный день: больше полутора часов глубокой работы 🎯"
            else -> "Хороший ритм. Если отвлечений мало, следующая сессия будет длиннее."
        }
    }

    private fun card(vararg v: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(16))
        background = GradientDrawable().apply { setColor(Color.parseColor("#181d28")); cornerRadius = dp(14).toFloat() }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
        v.forEach { addView(it) }
    }

    private fun dp(x: Int) = (x * resources.displayMetrics.density).toInt()
}
