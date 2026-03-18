import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { BUILDING_NAMES_EN } from '../constants/buildingData';
import { useUser } from '../contexts/UserContext';

const SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds (백엔드 auto-sync와 동기화)

const STORAGE_KEYS = {
  LAST_KNOWN: 'lastKnownReservations',
  NOTIFICATIONS: 'notifications',
  IS_FIRST_LOAD: 'notificationFirstLoad'
};

// Simple UUID generator
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
};

/**
 * useNotifications Hook
 *
 * Manages smart notification system with 15-minute polling
 * Compares reservation data and generates notifications for:
 * - New bookings (✨)
 * - Cancellations (❌)
 * - Modifications (📝)
 */
export const useNotifications = () => {
  const { companyId } = useUser();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Initialize notifications from localStorage
  useEffect(() => {
    const storedNotifications = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (storedNotifications) {
      try {
        const parsed = JSON.parse(storedNotifications);
        setNotifications(parsed);
        setUnreadCount(parsed.filter(n => !n.isRead).length);
      } catch (error) {
        console.error('Failed to parse stored notifications:', error);
        localStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS);
      }
    }

    const lastSync = localStorage.getItem('lastNotificationSync');
    if (lastSync) {
      setLastSyncTime(parseInt(lastSync));
    }
  }, []);

  // Fetch all confirmed reservations from Firestore
  const fetchReservations = useCallback(async (currentCompanyId) => {
    try {
      if (!currentCompanyId) {
        console.warn('⚠️ No companyId available for notifications');
        return null;
      }

      const reservationsQuery = query(
        collection(db, 'reservations'),
        where('companyId', '==', currentCompanyId),
        where('status', 'in', ['confirmed', 'cancelled'])
      );

      const snapshot = await getDocs(reservationsQuery);
      const reservations = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`🔔 Fetched ${reservations.length} reservations for company ${currentCompanyId}`);
      return reservations;
    } catch (error) {
      console.error('Failed to fetch reservations:', error);
      return null;
    }
  }, []);

  // Convert Korean building names to English
  const getBuildingNameEN = useCallback((buildingKR) => {
    // Handle special case for Okubo buildings (A동, B동, C동)
    if (buildingKR?.includes('오쿠보')) {
      if (buildingKR.includes('A')) return 'Okubo A';
      if (buildingKR.includes('B')) return 'Okubo B';
      if (buildingKR.includes('C')) return 'Okubo C';
      return 'Okubo';
    }
    return BUILDING_NAMES_EN[buildingKR] || buildingKR;
  }, []);

  // Format date for display (e.g., "Feb 10")
  const formatDate = useCallback((dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  // Format price for display (e.g., "¥45,000" or "$450")
  const formatPrice = useCallback((price) => {
    if (!price || price === 0) return '';
    // Assume JPY if price is large (> 1000), USD otherwise
    if (price >= 1000) {
      return `¥${price.toLocaleString('ja-JP')}`;
    } else {
      return `$${price.toLocaleString('en-US')}`;
    }
  }, []);

  // Generate notification message based on type
  const generateMessage = useCallback((type, oldReservation, newReservation) => {
    const reservation = newReservation || oldReservation;
    const guestName = reservation.guestName || 'Guest';
    const buildingEN = getBuildingNameEN(reservation.building);
    const platform = reservation.platform || 'Unknown';
    const price = reservation.totalPrice || reservation.price || 0;
    const priceText = formatPrice(price);

    switch (type) {
      case 'NEW':
        return `✨ New: ${guestName} · ${platform} · ${buildingEN}${priceText ? ` · ${priceText}` : ''}`;

      case 'CANCEL':
        return `❌ Canceled: ${guestName} · ${buildingEN}${priceText ? ` · ${priceText}` : ''}`;

      case 'MODIFY':
        let changes = [];

        // Check date changes
        if (oldReservation.arrival !== newReservation.arrival) {
          changes.push(
            `Date Changed (${formatDate(oldReservation.arrival)} → ${formatDate(newReservation.arrival)})`
          );
        }

        // Check guest count changes
        const oldGuests = (oldReservation.numAdult || 0) + (oldReservation.numChild || 0);
        const newGuests = (newReservation.numAdult || 0) + (newReservation.numChild || 0);
        if (oldGuests !== newGuests) {
          changes.push(`Guests Changed (${oldGuests} → ${newGuests})`);
        }

        // Check nights changes
        const oldNights = calculateNights(oldReservation.arrival, oldReservation.departure);
        const newNights = calculateNights(newReservation.arrival, newReservation.departure);
        if (oldNights !== newNights) {
          changes.push(`Nights Changed (${oldNights} → ${newNights})`);
        }

        // Check price changes
        const oldPrice = oldReservation.totalPrice || oldReservation.price || 0;
        const newPrice = newReservation.totalPrice || newReservation.price || 0;
        if (oldPrice !== newPrice) {
          changes.push(`Price Changed (${formatPrice(oldPrice)} → ${formatPrice(newPrice)})`);
        }

        const changeText = changes.length > 0 ? changes.join(', ') : 'Details Modified';
        return `📝 Modified: ${guestName} · ${changeText}`;

      default:
        return `Notification for ${guestName}`;
    }
  }, [getBuildingNameEN, formatDate, formatPrice]);

  // Calculate number of nights
  const calculateNights = (arrival, departure) => {
    if (!arrival || !departure) return 0;
    const start = new Date(arrival);
    const end = new Date(departure);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Compare two reservation datasets and generate notifications
  const compareAndNotify = useCallback((oldData, newData) => {
    const newNotifications = [];

    // Create maps for efficient lookup
    const oldMap = new Map(oldData.map(r => [r.id, r]));
    const newMap = new Map(newData.map(r => [r.id, r]));

    // Check for new bookings
    newData.forEach(newRes => {
      if (!oldMap.has(newRes.id) && newRes.status === 'confirmed') {
        newNotifications.push({
          id: generateUUID(),
          type: 'NEW',
          message: generateMessage('NEW', null, newRes),
          timestamp: Date.now(),
          isRead: false,
          linkTo: '/arrivals',
          reservationId: newRes.id,
          guestName: newRes.guestName
        });
      }
    });

    // Check for cancellations and modifications
    oldData.forEach(oldRes => {
      const newRes = newMap.get(oldRes.id);

      // Cancellation: status changed to cancelled
      if (newRes && oldRes.status === 'confirmed' && newRes.status === 'cancelled') {
        newNotifications.push({
          id: generateUUID(),
          type: 'CANCEL',
          message: generateMessage('CANCEL', oldRes, null),
          timestamp: Date.now(),
          isRead: false,
          linkTo: '/arrivals',
          reservationId: oldRes.id,
          guestName: oldRes.guestName
        });
      }

      // Modification: check for changes in confirmed bookings
      else if (newRes && oldRes.status === 'confirmed' && newRes.status === 'confirmed') {
        const oldPrice = oldRes.totalPrice || oldRes.price || 0;
        const newPrice = newRes.totalPrice || newRes.price || 0;

        const hasChanges =
          oldRes.arrival !== newRes.arrival ||
          oldRes.departure !== newRes.departure ||
          oldRes.numAdult !== newRes.numAdult ||
          oldRes.numChild !== newRes.numChild ||
          oldPrice !== newPrice;

        if (hasChanges) {
          newNotifications.push({
            id: generateUUID(),
            type: 'MODIFY',
            message: generateMessage('MODIFY', oldRes, newRes),
            timestamp: Date.now(),
            isRead: false,
            linkTo: '/arrivals',
            reservationId: newRes.id,
            guestName: newRes.guestName
          });
        }
      }
    });

    return newNotifications;
  }, [generateMessage]);

  // Compress reservation data to minimal fields needed for comparison
  const compressReservations = useCallback((reservations) => {
    return reservations.map(r => ({
      id: r.id,
      status: r.status,
      bookDate: r.bookDate,
      guestName: r.guestName,
      building: r.building,
      platform: r.platform,
      totalPrice: r.totalPrice,
      price: r.price,
      arrival: r.arrival,
      departure: r.departure,
      numAdult: r.numAdult,
      numChild: r.numChild
    }));
  }, []);

  // Main sync function - fetches data and generates notifications
  const syncReservations = useCallback(async (isManual = false) => {
    if (!companyId) {
      console.warn('⚠️ Cannot sync notifications: no companyId');
      return;
    }

    setIsLoading(true);

    try {
      // Fetch latest reservations
      const fetchedReservations = await fetchReservations(companyId);

      if (!fetchedReservations) {
        // Silent retry on network error
        setIsLoading(false);
        return;
      }

      // Compress data to reduce localStorage size
      const compressedData = compressReservations(fetchedReservations);

      // Check if this is the first load
      const isFirstLoad = localStorage.getItem(STORAGE_KEYS.IS_FIRST_LOAD) === null;

      if (isFirstLoad) {
        // First load: generate notifications for recent bookings (last 3 days)
        console.log('📊 [DEBUG] 첫 로드 감지 - 알림 생성 시작');
        console.log('📊 [DEBUG] 전체 예약 데이터 개수:', compressedData.length);
        console.log('📊 [DEBUG] confirmed 예약:', compressedData.filter(r => r.status === 'confirmed').length);

        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        console.log('📊 [DEBUG] 3일 전 기준 날짜:', new Date(threeDaysAgo).toISOString());

        const recentBookings = compressedData.filter(res => {
          const bookDate = res.bookDate || res.arrival;
          if (!bookDate) {
            console.log('⚠️ [DEBUG] bookDate 없음:', res.id, res.guestName);
            return false;
          }
          const bookTimestamp = new Date(bookDate).getTime();
          const isRecent = bookTimestamp >= threeDaysAgo;
          const isConfirmed = res.status === 'confirmed';

          if (!isRecent) {
            console.log('📊 [DEBUG] 오래된 예약 (3일 이전):', res.guestName, bookDate);
          }

          return isRecent && isConfirmed;
        });

        console.log('📊 [DEBUG] 최근 3일 내 예약:', recentBookings.length);
        recentBookings.forEach(r => {
          console.log('  - ', r.guestName, '/', r.building, '/', r.bookDate || r.arrival);
        });

        const initialNotifications = recentBookings.map(res => ({
          id: generateUUID(),
          type: 'NEW',
          message: generateMessage('NEW', null, res),
          timestamp: Date.now(),
          isRead: false,
          linkTo: '/arrivals',
          reservationId: res.id,
          guestName: res.guestName
        }));

        console.log('📊 [DEBUG] 생성된 알림 개수:', initialNotifications.length);

        if (initialNotifications.length > 0) {
          setNotifications(initialNotifications.slice(0, 20)); // Keep max 20
          setUnreadCount(initialNotifications.slice(0, 20).length);
          localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(initialNotifications.slice(0, 20)));
          console.log(`🔔 초기 로드: 최근 3일 내 ${initialNotifications.length}개 예약 알림 생성됨`);
        } else {
          console.log('⚠️ [DEBUG] 알림이 생성되지 않음 - 최근 3일 내 예약이 없거나 조건 불일치');
        }

        try {
          localStorage.setItem(STORAGE_KEYS.LAST_KNOWN, JSON.stringify(compressedData));
          localStorage.setItem(STORAGE_KEYS.IS_FIRST_LOAD, 'false');
          console.log('📊 Initial baseline set. Future notifications will appear on next sync.');
        } catch (storageError) {
          console.error('⚠️ Storage error (first load):', storageError);
          localStorage.removeItem(STORAGE_KEYS.LAST_KNOWN);
          localStorage.setItem(STORAGE_KEYS.LAST_KNOWN, JSON.stringify(compressedData));
        }
      } else {
        // Subsequent loads: compare and generate notifications
        const lastKnownRaw = localStorage.getItem(STORAGE_KEYS.LAST_KNOWN);
        const lastKnownReservations = lastKnownRaw ? JSON.parse(lastKnownRaw) : [];

        const newNotifications = compareAndNotify(lastKnownReservations, compressedData);

        if (newNotifications.length > 0 || isManual) {
          // Update notifications list
          const existingNotifications = notifications;
          const updatedNotifications = [...newNotifications, ...existingNotifications].slice(0, 20); // Keep max 20

          setNotifications(updatedNotifications);
          setUnreadCount(updatedNotifications.filter(n => !n.isRead).length);

          // Save to localStorage
          localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updatedNotifications));

          if (isManual && newNotifications.length === 0) {
            console.log('✅ Manual sync complete. No new changes detected.');
          } else {
            console.log(`🔔 ${newNotifications.length} new notification(s) generated.`);
          }
        }

        // Update baseline with compressed data
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_KNOWN, JSON.stringify(compressedData));
        } catch (storageError) {
          console.error('⚠️ Storage quota exceeded. Clearing old data...', storageError);
          // Clear and retry with fresh compressed data
          localStorage.removeItem(STORAGE_KEYS.LAST_KNOWN);
          localStorage.setItem(STORAGE_KEYS.LAST_KNOWN, JSON.stringify(compressedData));
        }
      }

      // Update last sync time
      const now = Date.now();
      setLastSyncTime(now);
      localStorage.setItem('lastNotificationSync', now.toString());

    } catch (error) {
      console.error('Sync error:', error);
      // Silent retry - don't show error to user
    } finally {
      setIsLoading(false);
    }
  }, [companyId, fetchReservations, compareAndNotify, notifications, compressReservations]);

  // Set up 15-minute polling interval
  useEffect(() => {
    if (!companyId) {
      console.log('⏳ Waiting for companyId to initialize notifications...');
      return;
    }

    // Initial sync after 5 seconds
    const initialTimer = setTimeout(() => {
      syncReservations();
    }, 5000);

    // Set up recurring sync
    const intervalId = setInterval(() => {
      syncReservations();
    }, SYNC_INTERVAL);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [companyId, syncReservations]);

  // Mark notification as read
  const markAsRead = useCallback((notificationId) => {
    setNotifications(prev => {
      const updated = prev.map(n =>
        n.id === notificationId ? { ...n, isRead: true } : n
      );
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
      setUnreadCount(updated.filter(n => !n.isRead).length);
      return updated;
    });
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, isRead: true }));
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
      setUnreadCount(0);
      return updated;
    });
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify([]));
  }, []);

  // Force sync (for development/testing)
  const forceSync = useCallback(() => {
    // Reset first load flag to regenerate notifications from scratch
    localStorage.removeItem(STORAGE_KEYS.IS_FIRST_LOAD);
    localStorage.removeItem(STORAGE_KEYS.LAST_KNOWN);
    console.log('🔄 알림 초기화: 최근 3일 알림을 다시 생성합니다...');
    syncReservations(true);
  }, [syncReservations]);

  return {
    notifications,
    unreadCount,
    isLoading,
    lastSyncTime,
    markAsRead,
    markAllAsRead,
    clearAll,
    forceSync
  };
};
