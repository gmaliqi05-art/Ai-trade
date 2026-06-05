import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Zap, Brain, AlertCircle, Crown, Megaphone, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/i18n';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  is_broadcast: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  signal_new: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  signal_high_confidence: { icon: Zap, color: 'text-green-400', bg: 'bg-green-500/10' },
  analysis_complete: { icon: Brain, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  subscription: { icon: Crown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  broadcast: { icon: Megaphone, color: 'text-red-400', bg: 'bg-red-500/10' },
  info: { icon: AlertCircle, color: 'text-gray-400', bg: 'bg-gray-700/50' },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.info;
}

export default function NotificationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${user.id},is_broadcast.eq.true`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(p => p.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    setNotifications(p => p.map(n => ({ ...n, is_read: true })));
  };

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(p => p.filter(n => n.id !== id));
  };

  const displayed = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;
  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bell className="w-6 h-6 text-amber-400" />{t('Njoftimet')}
            {unreadCount > 0 && (
              <span className="bg-amber-500 text-gray-950 text-xs font-black px-2 py-0.5 rounded-full">{unreadCount}</span>
            )}
          </h2>
          <p className="text-gray-400 text-sm mt-1">{t('{count} njoftime gjithsej', { count: notifications.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors">
              <CheckCheck className="w-4 h-4" />{t('Shëno të gjitha si të lexuara')}
            </button>
          )}
          <button onClick={fetchNotifications} disabled={refreshing} className="p-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {[{ id: 'all', label: t('Të gjitha') }, { id: 'unread', label: t('Të palexuara ({count})', { count: unreadCount }) }].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id as 'all' | 'unread')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === f.id ? 'bg-amber-500 text-gray-950' : 'bg-gray-900 border border-gray-700 text-gray-400 hover:text-white'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-900 rounded-2xl animate-pulse" />)}</div>
      ) : displayed.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-14 text-center">
          <Bell className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-white font-medium">{filter === 'unread' ? t('Asnjë njoftim i palexuar') : t('Ende pa njoftime')}</p>
          <p className="text-gray-500 text-sm mt-1">{t('Këtu do të marrësh njoftime për sinjale, analiza dhe alarme të reja')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(n => {
            const cfg = getTypeConfig(n.type);
            const Icon = cfg.icon;
            return (
              <div key={n.id} onClick={() => !n.is_read && markRead(n.id)} className={`bg-gray-900 border rounded-2xl p-4 flex items-start gap-4 transition-all group ${n.is_read ? 'border-gray-800 opacity-70' : 'border-amber-500/20 cursor-pointer hover:border-amber-500/40'}`}>
                <div className={`w-10 h-10 ${cfg.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${n.is_read ? 'text-gray-400' : 'text-white'}`}>{n.title}</p>
                      {!n.is_read && <div className="w-2 h-2 bg-amber-500 rounded-full flex-shrink-0 mt-0.5" />}
                      {n.is_broadcast && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-md">{t('Njoftim i përgjithshëm')}</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!n.is_read && (
                        <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className="opacity-0 group-hover:opacity-100 p-1 text-amber-400 hover:text-amber-300 transition-all" title={t('Shëno si të lexuar')}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }} className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-all" title={t('Fshi')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                  <p className="text-gray-600 text-xs mt-1.5">{new Date(n.created_at).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
