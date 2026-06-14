import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StaffNotification {
  id: string;
  venueId: string;
  eventId?: string;
  targetRole: string;
  notificationType: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  readAt?: string;
  readBy?: string;
  metadata: Record<string, any>;
}

interface UseStaffNotificationsOptions {
  venueId: string | null;
  targetRole: string;
  autoPlay?: boolean;
}

export function useStaffNotifications({ venueId, targetRole, autoPlay = true }: UseStaffNotificationsOptions) {
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!venueId) return;

    try {
      // Fetch notifications from last 24 hours
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);

      const { data, error } = await supabase
        .from('staff_notifications')
        .select('*')
        .eq('venue_id', venueId)
        .eq('target_role', targetRole)
        .gte('created_at', yesterday.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const mapped: StaffNotification[] = (data || []).map((n: any) => ({
        id: n.id,
        venueId: n.venue_id,
        eventId: n.event_id,
        targetRole: n.target_role,
        notificationType: n.notification_type,
        title: n.title,
        message: n.message,
        referenceType: n.reference_type,
        referenceId: n.reference_id,
        priority: n.priority || 'normal',
        createdAt: n.created_at,
        readAt: n.read_at,
        readBy: n.read_by,
        metadata: n.metadata || {},
      }));

      setNotifications(mapped);
      setUnreadCount(mapped.filter(n => !n.readAt).length);
    } catch (error) {
      console.error('Error fetching staff notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId, targetRole]);

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    if (!autoPlay) return;
    
    try {
      // Use Web Audio API for a simple beep
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 200);

      // Vibration on mobile
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch (e) {
      // Silent fail if audio not supported
    }
  }, [autoPlay]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!venueId) return;

    fetchNotifications();

    const channel = supabase
      .channel(`staff_notifications_${venueId}_${targetRole}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'staff_notifications',
          filter: `venue_id=eq.${venueId}`,
        },
        (payload) => {
          const newNotif = payload.new as any;
          if (newNotif.target_role === targetRole) {
            const mapped: StaffNotification = {
              id: newNotif.id,
              venueId: newNotif.venue_id,
              eventId: newNotif.event_id,
              targetRole: newNotif.target_role,
              notificationType: newNotif.notification_type,
              title: newNotif.title,
              message: newNotif.message,
              referenceType: newNotif.reference_type,
              referenceId: newNotif.reference_id,
              priority: newNotif.priority || 'normal',
              createdAt: newNotif.created_at,
              readAt: newNotif.read_at,
              readBy: newNotif.read_by,
              metadata: newNotif.metadata || {},
            };

            setNotifications(prev => [mapped, ...prev]);
            setUnreadCount(prev => prev + 1);
            
            // Play sound for high priority
            if (['high', 'urgent'].includes(mapped.priority)) {
              playNotificationSound();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, targetRole, fetchNotifications, playNotificationSound]);

  const markAsRead = async (notificationId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('staff_notifications')
        .update({
          read_at: new Date().toISOString(),
          read_by: user?.id,
        })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!venueId) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const unreadIds = notifications.filter(n => !n.readAt).map(n => n.id);
      
      if (unreadIds.length === 0) return;

      const { error } = await supabase
        .from('staff_notifications')
        .update({
          read_at: new Date().toISOString(),
          read_by: user?.id,
        })
        .in('id', unreadIds);

      if (error) throw error;

      setNotifications(prev => 
        prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}
