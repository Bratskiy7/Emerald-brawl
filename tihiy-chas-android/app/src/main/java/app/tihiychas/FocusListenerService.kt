package app.tihiychas

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Перехватывает уведомления во время фокуса: несрочные убирает и кладёт в очередь,
 * срочные, звонки, будильники и постоянные (музыка, навигация) не трогает.
 */
class FocusListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        if (!Store.isFocus(this)) return

        val n = sbn.notification
        val cat = n.category
        // не трогаем звонки, будильники, навигацию, медиа и «живые» службы
        if (cat in setOf(Notification.CATEGORY_CALL, Notification.CATEGORY_ALARM,
                Notification.CATEGORY_NAVIGATION, Notification.CATEGORY_TRANSPORT,
                Notification.CATEGORY_PROGRESS, Notification.CATEGORY_SERVICE)) return
        if (sbn.isOngoing || (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        if (Store.isUrgent("$title $text")) return

        val label = try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
        } catch (e: Exception) { sbn.packageName }

        Store.enqueue(this, label, title, text)
        cancelNotification(sbn.key)
    }
}
